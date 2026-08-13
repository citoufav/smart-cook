import { UserPreferences, PrepStep, CookingStep } from '../types';
import { sseStreamFetch, SSEStreamController } from '../utils/sseStream';
import { trimContext } from './chatHistoryService';

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
2. 然后调用 modify_recipe 工具来实际更新菜谱数据
3. 工具执行完后，系统会自动告知结果，届时请确认修改完成

其他规则：
1. 回答简洁实用，新手友好
2. 用中文回答`;

const MODIFY_RECIPE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'modify_recipe',
      description: '修改当前菜谱数据，包括调整食材用量、替换食材名称、增删菜谱步骤。用户要求修改菜谱时调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: '修改原因或说明，用一句话概括',
          },
          changes: {
            type: 'array',
            description: '要执行的具体修改列表',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['adjust_ingredient', 'replace_ingredient', 'add_ingredient', 'remove_ingredient', 'update_step', 'add_step', 'remove_step', 'rename_dish'],
                  description: '修改类型',
                },
                dish: { type: 'string', description: '目标菜品名称' },
                new_dish: { type: 'string', description: '新的菜品名称（仅 rename_dish 时使用）' },
                ingredient: { type: 'string', description: '食材名称' },
                new_weight: { type: 'number', description: '调整后的用量(克)' },
                new_ingredient: { type: 'string', description: '替换为的新食材名称' },
                step_number: { type: 'integer', description: '步骤编号' },
                new_description: { type: 'string', description: '新的步骤描述' },
                add_after_step: { type: 'integer', description: '在此步骤编号后插入新步骤' },
              },
              required: ['type'],
            },
          },
        },
        required: ['reason', 'changes'],
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
  onToolCallDelta?: (toolCalls: Array<{ index: number; id?: string; name?: string; arguments: string }>) => void;
}

const MAX_CONTEXT_TOKENS = 200_000;

/**
 * 非流式聊天补全（用于工具调用后的跟进）
 */
export async function sendChatMessage(
  messages: { role: string; content: string; tool_call_id?: string }[],
  prefs: UserPreferences,
): Promise<string> {
  const baseUrl = (prefs.apiUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${prefs.apiKey}`,
    },
    body: JSON.stringify({
      model: prefs.modelName || 'deepseek-v4-pro',
      messages,
      stream: false,
      temperature: 1,
      max_tokens: 4096,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `请求失败(${resp.status})`);
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 菜谱聊天流式调用
 * 复用 SSE 流式，但不强制 JSON 格式，返回纯文本
 */
export function callAIChatStream(
  recipeContext: RecipeContext,
  messages: { role: 'user' | 'assistant'; content: string }[],
  prefs: UserPreferences,
  callbacks: ChatCallbacks,
  allowModify: boolean = false,
): SSEStreamController {
  const baseUrl = (prefs.apiUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const recipeText = buildRecipeContextText(recipeContext);

  const systemPrompt = allowModify ? CHAT_SYSTEM_PROMPT_WITH_MODIFY : CHAT_SYSTEM_PROMPT;

  let apiMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `以下是当前菜谱的完整信息，请在后续对话中基于此信息回答用户问题：\n\n${recipeText}` },
    { role: 'assistant', content: '好的，我已经了解了当前的菜谱。请问有什么可以帮助你的？' },
    ...messages,
  ];

  // 上下文长度控制：超过 200K token 则裁剪旧消息
  apiMessages = trimContext(apiMessages, MAX_CONTEXT_TOKENS, 3);

  const body: Record<string, unknown> = {
    model: prefs.modelName || 'deepseek-v4-pro',
    messages: apiMessages,
    stream: true,
  };

  if (allowModify) {
    body.tools = MODIFY_RECIPE_TOOLS;
    body.tool_choice = 'auto';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${prefs.apiKey}`,
  };

  return sseStreamFetch(
    url,
    body as unknown as Record<string, unknown>,
    headers,
    {
      onReasoning: callbacks.onReasoning,
      onContent: callbacks.onToken,
      onToolCallDelta: callbacks.onToolCallDelta,
      onDone: (fullContent: string, _fullReasoning: string, toolCalls?: Array<{ id: string; name: string; arguments: string }>) => {
        callbacks.onDone(
          fullContent,
          toolCalls?.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
        );
      },
      onError: callbacks.onError,
    },
    120_000, // 2 分钟超时
  );
}
