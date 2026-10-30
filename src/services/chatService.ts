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

用户已授权你修改菜谱。当用户要求修改菜谱时：
1. 先用一句话说明你要做什么修改
2. 然后调用 modify_recipe 工具，把修改要求用自然语言写在 summary 字段里
3. 系统会根据 summary 重新生成完整菜谱

其他规则：
1. 回答简洁实用，新手友好
2. 用中文回答`;

const MODIFY_RECIPE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'modify_recipe',
      description: '当用户要求修改菜谱时调用此工具，用自然语言描述修改要求。',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: '修改要求的自然语言描述，例如"把盐从2g改成3g，将番茄炒蛋换成番茄炒虾仁"',
          },
        },
        required: ['summary'],
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
  };

  if (allowModify) {
    body.tools = MODIFY_RECIPE_TOOLS;
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
      onDone: (fullContent: string, _fullReasoning: string, toolCalls?: { id: string; name: string; arguments: string }[]) => {
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
