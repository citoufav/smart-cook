import { UserPreferences, PrepStep, CookingStep } from '../types';
import { sseStreamFetch, SSEStreamController } from '../utils/sseStream';
import { trimContext } from './chatHistoryService';
import { aiEndpoint, aiHeaders, aiModel } from './aiClient';

const CHAT_SYSTEM_PROMPT = `你是一位专业家庭厨师和营养顾问。你正在帮用户做一道菜，请根据当前菜谱信息回答用户的问题。

规则：
1. 只围绕当前菜谱回答，不主动推荐其他菜品
2. 回答简洁实用，新手友好
3. 涉及用量时给出确切克数或时间
4. 用户问替代方案时，优先使用常见家常替代品
5. 用中文回答`;

const CHAT_SYSTEM_PROMPT_WITH_MODIFY = `你是一位专业家庭厨师和营养顾问。你正在帮用户做一道菜，请根据当前菜谱信息回答用户的问题。

用户已授权你修改菜谱。要求：
1. 先一句话说明你要改什么，然后调用 edit_menu 工具
2. **只下发最小改动**：用户说改盐的克数，就只给一条 set_grams，不要顺手改别的菜、别的食材
3. dish 必须与当前菜谱里的菜名完全一致；找不到对应菜就不要下发该动作，改为用文字问清楚
4. **分清"加食材"和"加菜"**：用户只是要往已有菜里添/减一样东西（"加个牛奶""不要葱花"），
   用 add_ingredient / remove_ingredient，dish 填要加进哪道菜；只有用户明确说"再来一道菜""换个菜"，
   才用 add_dish / replace_dish，并在 instruction 里写清要什么菜。拿不准是哪道菜时，先在文字里问，不要猜。
5. 一次可以给多条动作，它们会按顺序执行

其他规则：
1. 回答简洁实用，新手友好
2. 用中文回答`;

/**
 * 结构化编辑工具。
 *
 * 刻意**不开 strict 模式**：strict 要求 required 覆盖所有字段，而我们这里
 * 每个动作只用到其中两三个，只能靠 oneOf 或全部可空来表达，两者都更容易出错。
 * 用扁平对象 + op 枚举 + 字段说明，实测更稳。
 */
const EDIT_MENU_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'edit_menu',
      description:
        '按用户要求对当前菜谱做最小改动。每一条只描述一处变化，不要重写整份菜单。'
        + '可用的 op：set_grams（改某道菜里某食材的克数）、add_ingredient（给某道菜加食材）、'
        + 'remove_ingredient（去掉某道菜的食材）、remove_dish（删掉整道菜）、'
        + 'set_person_count（改用餐人数，用量会按比例缩放）、'
        + 'replace_dish（整道菜换成新的）、add_dish（新增一道菜）。'
        + '注意：用户只是要加/减一个食材时用 add_ingredient / remove_ingredient，'
        + '只有明确要一道新菜时才用 add_dish。',
      parameters: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            description: '按顺序执行的修改动作',
            items: {
              type: 'object',
              properties: {
                op: {
                  type: 'string',
                  enum: [
                    'set_grams',
                    'add_ingredient',
                    'remove_ingredient',
                    'remove_dish',
                    'set_person_count',
                    'replace_dish',
                    'add_dish',
                  ],
                  description: '动作类型',
                },
                dish: { type: 'string', description: '菜名，必须与当前菜谱完全一致（set_grams/add_ingredient/remove_ingredient/remove_dish/replace_dish 必填）' },
                ingredient: { type: 'string', description: '食材名（set_grams/add_ingredient/remove_ingredient 必填）' },
                grams: { type: 'number', description: '克数，整数（set_grams/add_ingredient 必填）' },
                personCount: { type: 'number', description: '新的用餐人数（set_person_count 必填）' },
                instruction: { type: 'string', description: '一句话说明要什么样的菜（replace_dish/add_dish 必填）' },
              },
              required: ['op'],
            },
          },
        },
        required: ['edits'],
      },
    },
  },
];

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: string;
}

export interface RecipeContext {
  dishName?: string;
  dishes?: { name: string; ingredients: { name: string; estimatedWeight: number }[] }[];
  prepSteps?: PrepStep[];
  cookingSteps?: CookingStep[];
  currentStep?: number;
  sessionId?: string;
}

function buildRecipeContextText(ctx: RecipeContext): string {
  const parts: string[] = [];

  if (ctx.dishes && ctx.dishes.length > 0) {
    parts.push('【当前菜谱】');
    for (const dish of ctx.dishes) {
      const ingredientList = dish.ingredients?.map((i) => `${i.name}(${i.estimatedWeight}g)`).join('、') || '';
      parts.push(`- ${dish.name}：${ingredientList}`);
    }
  } else if (ctx.dishName) {
    parts.push(`【当前菜品】${ctx.dishName}`);
  }

  if (ctx.prepSteps && ctx.prepSteps.length > 0) {
    parts.push('\n【备菜步骤】');
    for (const step of ctx.prepSteps) {
      parts.push(`${step.order}. ${step.description}`);
    }
  }

  if (ctx.cookingSteps && ctx.cookingSteps.length > 0) {
    parts.push('\n【炒制步骤】');
    for (const step of ctx.cookingSteps) {
      parts.push(`${step.stepNumber}. [${step.dishName}] ${step.instruction}`);
    }
  }

  if (ctx.currentStep !== undefined && ctx.cookingSteps) {
    const step = ctx.cookingSteps.find((s) => s.stepNumber === ctx.currentStep);
    if (step) {
      parts.push(`\n用户当前正在执行第 ${ctx.currentStep} 步：${step.instruction}`);
    }
  }

  return parts.join('\n');
}

export interface ChatCallbacks {
  onReasoning: (text: string) => void;
  onToken: (text: string) => void;
  onDone: (fullText: string, toolCalls?: ToolCallResult[]) => void;
  onError: (error: Error) => void;
  onToolCallDelta?: (toolCalls: { index: number; id?: string; name?: string; arguments: string }[]) => void;
}

const MAX_CONTEXT_TOKENS = 200_000;

/**
 * Streaming chat call for recipe conversation
 * Reuses the SSE stream but does not force JSON format; returns plain text
 */
export function callAIChatStream(
  recipeContext: RecipeContext,
  messages: { role: 'user' | 'assistant'; content: string }[],
  prefs: UserPreferences,
  callbacks: ChatCallbacks,
  allowModify: boolean = false,
): SSEStreamController {
  const url = aiEndpoint(prefs);

  const recipeText = buildRecipeContextText(recipeContext);

  const systemPrompt = allowModify ? CHAT_SYSTEM_PROMPT_WITH_MODIFY : CHAT_SYSTEM_PROMPT;

  let apiMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `以下是当前菜谱的完整信息，请在后续对话中基于此信息回答用户问题：\n\n${recipeText}` },
    { role: 'assistant', content: '好的，我已经了解了当前的菜谱。请问有什么可以帮助你的？' },
    ...messages,
  ];

  // Context length control: trim old messages when exceeding 200K tokens
  apiMessages = trimContext(apiMessages, MAX_CONTEXT_TOKENS, 3);

  const body: Record<string, unknown> = {
    model: aiModel(prefs),
    messages: apiMessages,
    stream: true,
    thinking: { type: 'disabled' },
    // 聊天回复不该很长，给个明确上限，避免异常输出把话费打飞
    max_tokens: 4_096,
  };

  if (allowModify) {
    body.tools = EDIT_MENU_TOOLS;
    body.tool_choice = 'auto';
  }

  return sseStreamFetch(
    url,
    body as unknown as Record<string, unknown>,
    aiHeaders(prefs),
    {
      onReasoning: callbacks.onReasoning,
      onContent: callbacks.onToken,
      onToolCallDelta: callbacks.onToolCallDelta,
      onDone: (fullContent: string, _fullReasoning: string, toolCalls?: { id: string; name: string; arguments: string }[], finishReason?: string) => {
        if (finishReason === 'length') {
          callbacks.onError(new Error('回复太长被截断了，再问一次或者说得更具体点'));
          return;
        }
        callbacks.onDone(
          fullContent,
          toolCalls?.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
        );
      },
      onError: callbacks.onError,
    },
    120_000, // 2-minute timeout
  );
}
