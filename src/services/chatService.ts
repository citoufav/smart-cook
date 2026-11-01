import { UserPreferences, DishPlan } from '../types';
import { sseStreamFetch, SSEStreamController } from '../utils/sseStream';
import { trimContext } from './chatHistoryService';
import { aiEndpoint, aiHeaders, aiBody, aiProtocol, type AIChatMessage } from './aiClient';

/**
 * 菜谱助手**只回答问题和给建议，不改菜谱**。
 *
 * 改菜谱是确定性操作（改克数、删一道菜），用界面上的按钮直接做，不需要模型；
 * 只有"加一道菜"要 AI，那是独立入口，不在这里。让聊天既能聊又能改的结果是
 * 用户每句话都要担心"它会不会擅自改我的菜谱"，而且模型选错动作就会改坏。
 */
const CHAT_SYSTEM_PROMPT = `你是一位专业家庭厨师和营养顾问，正在给用户当下手。用户会把当前菜谱发给你，你据此回答他的问题。

规则：
1. 只围绕当前菜谱和他正在做的这一步回答，不主动推荐别的菜
2. 回答简洁实用，新手友好；涉及用量给具体克数或时间
3. 用户问替代方案时，优先用常见家常替代品
4. 你没有修改菜谱的权限，也不要去改。用户想改菜谱时，按下面的【界面位置】告诉他去哪点
5. 用中文回答

【界面位置】用户问"在哪改/怎么加/怎么删"时，直接报位置，一两句话说完：
- 改克数 / 改调料用量：菜谱页 → 那道菜卡片右上角的铅笔 → 抽屉里改数字（改一个，其余按同倍数跟着变）
- 删一道菜：菜谱页 → 那道菜卡片右上角的垃圾桶
- 加一道菜：菜谱页 → 菜品清单最下面的虚线按钮「+ 加一道菜」
- 换配料 / 换做法（比如改火候、先焯水再炒）：菜谱页 → 铅笔 → 抽屉最下面「让 AI 重做」
- 采购清单：菜谱页 → 黄色「库存不足」提示块右下角的「查看采购清单」
- 看营养明细：右下角显示大卡的那个圆球
- 切到备菜 / 炒制页：底部三个圆点，或左右滑动
- 做完这顿：底部绿色「完成做菜」
- 改模型 / API Key / 忌口 / 烹饪熟练度：做菜首页或库存页 → 左上角菜单图标

注意：**备菜页和炒制页只能看不能改**，它们是从上往下照着做的执行页。用户在那两页说想改数字，先告诉他滑回菜谱页改。`;

export interface RecipeContext {
  dishes?: DishPlan[];
  currentStep?: number;
  sessionId?: string;
}

function buildRecipeContextText(ctx: RecipeContext): string {
  const dishes = ctx.dishes ?? [];
  if (dishes.length === 0) return '（当前没有菜谱）';

  const parts: string[] = ['【当前菜谱】'];
  for (const dish of dishes) {
    const ingredientList = dish.ingredients.map((i) => `${i.name}(${i.estimatedWeight}g)`).join('、');
    const seasoningList = dish.seasonings.map((s) => `${s.name}${s.amount}`).join('、');
    parts.push(`- ${dish.name}：${ingredientList}${seasoningList ? `；调料：${seasoningList}` : ''}`);

    if (dish.prepSteps.length > 0) {
      parts.push('  备菜：' + dish.prepSteps.map((s) => s.description).join('；'));
    }
    if (dish.cookingSteps.length > 0) {
      parts.push('  炒制：' + dish.cookingSteps.map((s) => s.instruction).join('；'));
    }
  }

  if (ctx.currentStep !== undefined) {
    const all = dishes.flatMap((d) => d.cookingSteps);
    const step = all[ctx.currentStep - 1];
    if (step) parts.push(`\n用户当前正在执行第 ${ctx.currentStep} 步：${step.instruction}`);
  }

  return parts.join('\n');
}

export interface ChatCallbacks {
  onReasoning: (text: string) => void;
  onToken: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

const MAX_CONTEXT_TOKENS = 200_000;

/**
 * 流式聊天：不强制 JSON、不挂工具，就是普通对话补全
 */
export function callAIChatStream(
  recipeContext: RecipeContext,
  messages: { role: 'user' | 'assistant'; content: string }[],
  prefs: UserPreferences,
  callbacks: ChatCallbacks,
): SSEStreamController {
  const url = aiEndpoint(prefs);
  const recipeText = buildRecipeContextText(recipeContext);

  let apiMessages: AIChatMessage[] = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    { role: 'user', content: `以下是当前菜谱的完整信息，请在后续对话中基于此信息回答用户问题：\n\n${recipeText}` },
    { role: 'assistant', content: '好的，我已经了解了当前的菜谱。请问有什么可以帮助你的？' },
    ...messages,
  ];

  // Context length control: trim old messages when exceeding 200K tokens
  apiMessages = trimContext(apiMessages, MAX_CONTEXT_TOKENS, 3);

  const body = aiBody(prefs, {
    messages: apiMessages,
    // 聊天回复不该很长，给个明确上限，避免异常输出把话费打飞
    maxTokens: 4_096,
    thinking: 'off',
  });

  return sseStreamFetch(
    url,
    body,
    aiHeaders(prefs),
    {
      onReasoning: callbacks.onReasoning,
      onContent: callbacks.onToken,
      onDone: (fullContent: string, _fullReasoning: string, _toolCalls?: unknown, finishReason?: string) => {
        if (finishReason === 'length') {
          callbacks.onError(new Error('回复太长被截断了，再问一次或者说得更具体点'));
          return;
        }
        callbacks.onDone(fullContent);
      },
      onError: callbacks.onError,
    },
    120_000, // 2-minute timeout
    aiProtocol(prefs),
  );
}
