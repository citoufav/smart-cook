import { z } from 'zod';
import { UserPreferences, MenuProposal } from '../types';
import { DEFAULT_TIMEOUT_MS, MAX_RETRIES, BASE_RETRY_DELAY_MS } from '../constants/cooking';
import { sseStreamFetch, SSEStreamController } from '../utils/sseStream';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/maskApiKey';
import { aiEndpoint, aiHeaders, aiModel } from './aiClient';

const log = logger('SVC:AI');

/** 不可重试的错误（鉴权失败、参数错误、限流到顶等），直接抛出终止重试循环 */
export class AINonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AINonRetryableError';
  }
}

// ---------------------------------------------------------------------------
// AI 输出校验（zod）：字段级异常回退默认值（尽力渲染），结构级异常才报错
// ---------------------------------------------------------------------------

/** 数值字段：无法解析/非有限数 → 0 */
const numField = z.coerce.number().transform((v) => (Number.isFinite(v) ? v : 0));

/** 可选字符串字段：非字符串/空串 → undefined */
const optionalStr = z.any().transform((v) => (typeof v === 'string' && v.trim() ? v : undefined));

const nutritionSchema = z.object({
  calories: numField.catch(0),
  protein: numField.catch(0),
  fat: numField.catch(0),
  carbs: numField.catch(0),
});

const dishSchema = z
  .object({
    name: z.string().catch('未命名菜品'),
    ingredients: z
      .array(
        z.object({
          name: z.string().catch(''),
          estimatedWeight: numField.catch(0),
          isInInventory: z.boolean().catch(false),
        }),
      )
      .catch([]),
    seasonings: z
      .array(
        z.object({
          name: z.string().catch(''),
          amount: z.string().catch(''),
          isInInventory: z.boolean().catch(false),
        }),
      )
      .catch([]),
    estimatedNutrition: nutritionSchema.catch({ calories: 0, protein: 0, fat: 0, carbs: 0 }),
  })
  .passthrough();

const prepStepSchema = z
  .object({
    id: optionalStr,
    ingredientName: z.string().catch(''),
    quantity: z.string().catch(''),
    dishName: optionalStr,
    description: z.string().catch(''),
    isCompleted: z.boolean().catch(false),
    order: numField.catch(0),
  })
  .passthrough();

const cookingStepSchema = z
  .object({
    stepNumber: numField.catch(0),
    dishName: z.string().catch(''),
    instruction: z.string().catch(''),
    isCompleted: z.boolean().catch(false),
  })
  .passthrough();

const missingItemSchema = z
  .object({
    type: z.enum(['ingredient', 'seasoning']).catch('ingredient'),
    name: z.string().catch(''),
    suggestedAmount: z.string().catch(''),
    forDish: z.string().catch(''),
  })
  .passthrough();

const stage1ResultSchema = z
  .object({
    summary: z
      .object({
        description: z.string().catch(''),
        cookingOrder: z.string().catch(''),
        flavorNotes: z.string().catch(''),
      })
      .passthrough()
      .catch({ description: '', cookingOrder: '', flavorNotes: '' }),
    dishes: z.array(dishSchema).catch([]),
    prepSteps: z.array(prepStepSchema).catch([]),
    cookingSteps: z.array(cookingStepSchema).catch([]),
    preciseNutrition: z.array(nutritionSchema).catch([]),
    missingItems: z.array(missingItemSchema).catch([]),
    cookingOrderDescription: z.string().catch(''),
    flavorDescription: z.string().catch(''),
  })
  .passthrough();

/**
 * 校验并规范化 AI 返回的菜谱 JSON：
 * - 字段级异常回退默认值（缺 prep id/stepNumber 自动补齐）
 * - 结构级异常（根不是对象等）向上抛出，由调用方提示"返回格式异常"
 */
export function parseStage1Result(raw: unknown, reasoningContent: string): Stage1AIResult {
  const parsed = stage1ResultSchema.parse(raw);
  const prepSteps = parsed.prepSteps.map((s, i) => ({
    ...s,
    id: s.id ?? `prep-${i + 1}`,
  }));
  const cookingSteps = parsed.cookingSteps.map((s, i) => ({
    ...s,
    stepNumber: s.stepNumber > 0 ? s.stepNumber : i + 1,
  }));
  return {
    summary: parsed.summary,
    dishes: parsed.dishes,
    prepSteps,
    cookingSteps,
    preciseNutrition: parsed.preciseNutrition,
    missingItems: parsed.missingItems,
    cookingOrderDescription: parsed.cookingOrderDescription,
    flavorDescription: parsed.flavorDescription,
    reasoningContent,
  };
}

function buildThinkingConfig(prefs: UserPreferences): { thinking: { type: 'enabled' | 'disabled' }; reasoning_effort?: 'high' | 'max' } {
  if (prefs.thinkingEnabled) {
    return {
      thinking: { type: 'enabled' },
      reasoning_effort: prefs.reasoningEffort,
    };
  }
  return { thinking: { type: 'disabled' } };
}

function getRetryDelay(attempt: number): number {
  const base = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 500;
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const SYSTEM_PROMPT_CN = `你是一位专业的家庭厨师和营养顾问。请严格遵循以下规则，每条规则附有示例。

【基本规则】
1. 优先消耗库存：首先使用库存中已有的食材和调料。
2. 最小化采买：尽量减少需要额外购买的食材和调料。
3. 统一单位：所有食材重量单位为"克"（g），调料在菜单规划阶段可用"适量/少许"等描述，在炒制步骤中必须给克重数字。
4. 严格 JSON：只返回纯 JSON，禁止用 \`\`\`json\`\`\` 包裹，禁止输出任何非 JSON 文本。
5. 全局一致性：生成前先通盘考虑备菜→炒制全流程，确保步骤衔接无矛盾。
6. 主食=菜品：米饭、馒头、面条、花卷、烙饼等主食与炒菜一样是独立菜品，必须包含在 dishes 中，有独立的 estimatedNutrition。

【营养与搭配】
7. 成年男性 600-800 大卡/餐，成年女性 500-600 大卡/餐。
8. 早餐 300-500 大卡，20 分钟内可完成。
9. 午餐/晚餐根据人数和热量目标合理搭配，荤素搭配，有主食。
10. 中餐为主，1人份主料 150-300g。

【备菜步骤 — 重要】
11. 相同食材、相同切配方式 → 必须合并为一个备菜步骤。
    ✅ 正确：小葱共10g，切葱花。description: "取[小葱(10g)]洗净，切成葱花"（多道菜品共用时只写一条，说明总量）
    ❌ 错误：小葱切葱花（紫菜蛋花汤）+ 小葱切葱花（凉拌西兰花）写成两个步骤
12. prepSteps 格式：每条包含 id("prep-N")、ingredientName(食材名)、quantity(用量如"200g")、dishName(所属菜品名)、description(操作描述)、isCompleted(false)、order(从1递增)。
    description 中用 [食材名(克重)] 引用食材。
    ✅ 正确："淘洗[大米(200g)]，换水浸泡20分钟后沥干"

【炒制步骤 — 重要】
13. 新手友好：每一步操作写明确切的克数、温度和时间。
    ✅ 正确："锅中加入[食用油(10g)]，烧至六成热（约160°C），放入[蒜末(5g)]爆香..."
    ❌ 错误："水米比例1:1.2"、"油温适中"、"适量加水"、"焖至熟"
    煮米饭等需要加水的操作：必须写确切水量，如"加入清水300g，大火煮沸后转小火焖15分钟"
14. cookingSteps.instruction 中用 [食材名(克重)] 引用食材。
    ✅ 正确："将[猪肉丝(150g)]倒入锅中，加入[清水(300g)]，大火煮沸"
15. cookingSteps 格式：每条包含 stepNumber(从1递增)、dishName(对应菜品名)、instruction(炒制说明)、isCompleted(false)。

【其他规则】
16. 调料必须给出克重数字：油类、酱油、醋、料酒、盐、糖、淀粉等一律用 [调料名(Xg)] 格式，禁止"适量/少许/X勺"。只有粉状调料（花椒粉、胡椒粉、十三香等）可用1-5g范围。
17. 食材不足时 dishes 数组不能为空，至少给出 1 道利用现有食材的简易菜（蛋炒饭、拌面、炒时蔬等）。
18. 所有输出使用中文。`;

function buildStage1UserPrompt(
  ingredients: { name: string; weight: number | null; createDate: string }[],
  seasonings: { name: string; status: string }[],
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
  dietaryRestrictions: string[],
  recentMeals?: string[],
  tastePreferences: string[] = [],
): string {
  const statusLabel: Record<string, string> = { sufficient: '充足', low: '少量', out: '缺少' };

  const ingredientLines = ingredients.length > 0
    ? ingredients
        .sort((a, b) => new Date(a.createDate).getTime() - new Date(b.createDate).getTime())
        .map((ing, i) => {
          const days = Math.floor((Date.now() - new Date(ing.createDate).getTime()) / 86400000);
          return `${i + 1}. ${ing.name}：${ing.weight !== null ? ing.weight + '克' : '重量未知'}（已存放${days}天）`;
        })
        .join('\n')
    : '库存中暂无食材。';

  const seasoningLines = seasonings.length > 0
    ? seasonings.map((s) => `- ${s.name}：${statusLabel[s.status] || s.status}`).join('\n')
    : '库存中暂无调料记录。';

  const calorieText = requirement.caloriePreference
    ? `热量目标：每人约${requirement.caloriePreference}大卡，${requirement.personCount}人总计约${requirement.caloriePreference * requirement.personCount}大卡，请确保所有菜品热量总和接近此目标`
    : `热量目标：不限，请根据${requirement.personCount}人份的营养指南合理搭配`;

  const customText = requirement.customRequirement ? `特殊需求：${requirement.customRequirement}` : '';
  const restrictionText = dietaryRestrictions.length > 0 ? `忌口：${dietaryRestrictions.join(', ')}` : '';
  const tasteText = tastePreferences.length > 0 ? `口味与菜系偏好：${tastePreferences.join(', ')}` : '';

  const dietMemoryText = recentMeals && recentMeals.length > 0
    ? `\n【饮食记忆】\n用户最近吃过的菜：${recentMeals.join('、')}\n请避免推荐与以上重复的菜品。`
    : '';

  return `【基本信息】
用餐人数：${requirement.personCount}人
餐类：${requirement.mealType}
${calorieText}
${customText}
${restrictionText}
${tasteText}
${dietMemoryText}

【库存食材】
${ingredientLines}

【库存调料】
${seasoningLines}

请严格按照以下 JSON Schema 返回，确保 dishes 数组至少包含 1 道菜品。

【prepSteps 生成规则】
- 覆盖所有需要切/洗/腌制的食材，相同切配方式必须合并为一个步骤
- description 中用 [食材名(克重)] 引用食材
- 示例：多道菜都用到葱花 → 合并为 "取[小葱(10g)]洗净，切成葱花"

【cookingSteps 生成规则】
- 按 cookingOrder 建议的顺序排列步骤，stepNumber 从 1 递增
- instruction 中用 [食材名(克重)] 引用食材
- 油、水、调料必须写确切克数，如 [食用油(10g)]、[清水(300g)]

JSON Schema：

{
  "summary": {
    "description": "整体菜单描述和搭配思路",
    "cookingOrder": "建议的制作顺序",
    "flavorNotes": "风味特点和搭配说明"
  },
  "dishes": [
    {
      "name": "菜名",
      "ingredients": [
        { "name": "食材名", "estimatedWeight": 克数, "isInInventory": true或false }
      ],
      "seasonings": [
        { "name": "调料名", "amount": "用量描述", "isInInventory": true或false }
      ],
      "estimatedNutrition": { "calories": 大卡, "protein": 克, "fat": 克, "carbs": 克 }
    }
  ],
  "prepSteps": [
    {
      "id": "prep-1",
      "ingredientName": "食材名",
      "quantity": "克数（如200g）",
      "dishName": "所属菜品名",
      "description": "操作描述，用 [食材名(克重)] 引用食材",
      "isCompleted": false,
      "order": 1
    }
  ],
  "cookingSteps": [
    {
      "stepNumber": 1,
      "dishName": "对应菜品名",
      "instruction": "炒制步骤，用 [食材名(克重)] 引用食材，水量写确切克数，油温写确切温度",
      "isCompleted": false
    }
  ],
  "preciseNutrition": [
    { "calories": 大卡, "protein": 克, "fat": 克, "carbs": 克 }
  ],
  "missingItems": [
    { "type": "ingredient或seasoning", "name": "名称", "suggestedAmount": "建议购买量", "forDish": "用于菜品名" }
  ],
  "cookingOrderDescription": "制作顺序简述",
  "flavorDescription": "风味特色简述"
}`;
}

export interface Stage1AIResult {
  dishes: any[];
  missingItems: any[];
  reasoningContent: string;
  summary?: any;
  estimatedNutrition?: any;
  cookingOrderDescription?: string;
  flavorDescription?: string;
  prepSteps?: any[];
  cookingSteps?: any[];
  preciseNutrition?: any[];
}

export async function callAIStage1(
  ingredients: { name: string; weight: number | null; createDate: string }[],
  seasonings: { name: string; status: string }[],
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
  dietaryRestrictions: string[],
  prefs: UserPreferences,
  recentMeals?: string[],
): Promise<Stage1AIResult> {
  const userPrompt = buildStage1UserPrompt(ingredients, seasonings, requirement, dietaryRestrictions, recentMeals, prefs.tastePreferences);
  const url = aiEndpoint(prefs);

  const body = {
    model: aiModel(prefs),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CN },
      { role: 'user', content: userPrompt },
    ],
    ...buildThinkingConfig(prefs),
    response_format: { type: 'json_object' },
  };

  const maskedKey = maskApiKey(prefs.apiKey);
  log.info(`调用 API: ${url}, Key: ${maskedKey}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: aiHeaders(prefs),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        if (response.status === 429) {
          if (attempt >= MAX_RETRIES) {
            throw new AINonRetryableError('请求过于频繁（429 限流），请稍后重试');
          }
          const retryAfter = response.headers.get('Retry-After');
          const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : NaN;
          const waitMs = Number.isFinite(retrySeconds) && retrySeconds > 0
            ? retrySeconds * 1000
            : getRetryDelay(attempt);
          log.warn(`429 限流，等待 ${waitMs}ms`);
          await sleep(waitMs);
          continue;
        }
        if (response.status === 400) {
          // 部分兼容端点不支持 response_format：降级重试一次。
          // 构造新 body 而非 delete，避免污染外层后续重试；降级失败视为不可重试。
          const fallbackBody = { ...body } as Record<string, unknown>;
          delete fallbackBody.response_format;
          try {
            const retryResponse = await fetchWithTimeout(url, {
              method: 'POST',
              headers: aiHeaders(prefs),
              body: JSON.stringify(fallbackBody),
            });
            if (!retryResponse.ok) {
              throw new AINonRetryableError('请求参数错误（400），请检查 API 地址与模型配置');
            }
            const retryData = await retryResponse.json();
            const retryContent = retryData.choices?.[0]?.message?.content;
            const retryReasoning = retryData.choices?.[0]?.message?.reasoning_content || '';
            if (!retryContent) throw new Error('重试后 AI 返回内容为空');
            return parseStage1Result(JSON.parse(retryContent), retryReasoning);
          } catch (e) {
            if (e instanceof AINonRetryableError) throw e;
            throw new AINonRetryableError('请求参数错误（400），降级重试后仍失败，请检查模型是否支持 JSON Output');
          }
        }
        if (response.status === 401) throw new AINonRetryableError('API Key 无效，请在设置中更新');
        if (response.status === 403) throw new AINonRetryableError('访问被拒绝（403），请检查 API Key 权限');
        if (response.status === 404) throw new AINonRetryableError('API 端点不存在（404），请检查 API 地址配置');
        if (response.status >= 500) {
          if (attempt < MAX_RETRIES) {
            await sleep(getRetryDelay(attempt));
            continue;
          }
          throw new AINonRetryableError(`AI 服务器错误（${response.status}）`);
        }
        // 其余未覆盖的状态码：不可重试，明确报出状态码，避免穿透到 response.json() 报假错
        throw new AINonRetryableError(`请求失败（${response.status}），请检查 API 配置`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      const reasoningContent = data.choices?.[0]?.message?.reasoning_content || '';
      if (!content) throw new Error('AI 返回内容为空（JSON Output 模式下偶发，请重试）');
      return parseStage1Result(JSON.parse(content), reasoningContent);
    } catch (error: any) {
      if (error instanceof AINonRetryableError) throw error;
      if (error.name === 'AbortError') {
        throw new Error('AI 请求超时（深度思考可能需要较长时间），是否重试？');
      }
      if (attempt >= MAX_RETRIES) throw error;
      await sleep(getRetryDelay(attempt));
    }
  }
  throw new Error('AI 调用达到最大重试次数');
}

/**
 * Streaming call for Stage1
 * Uses SSE streaming to receive AI reasoning and results in real time
 */
export function callAIStage1Stream(
  ingredients: { name: string; weight: number | null; createDate: string }[],
  seasonings: { name: string; status: string }[],
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
  dietaryRestrictions: string[],
  prefs: UserPreferences,
  recentMeals: string[] | undefined,
  callbacks: {
    onReasoning: (text: string) => void;
    onContent: (text: string) => void;
    onData?: () => void;
    onDone: (result: Stage1AIResult) => void;
    onError: (error: Error) => void;
  },
): SSEStreamController {
  const userPrompt = buildStage1UserPrompt(ingredients, seasonings, requirement, dietaryRestrictions, recentMeals, prefs.tastePreferences);
  const url = aiEndpoint(prefs);

  const body = {
    model: aiModel(prefs),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CN },
      { role: 'user', content: userPrompt },
    ],
    ...buildThinkingConfig(prefs),
    stream: true,
    response_format: { type: 'json_object' },
  };

  const maskedKey = maskApiKey(prefs.apiKey);
  log.info(`流式调用 API: ${url}, Key: ${maskedKey}`);

  log.info(`Stage1 流式调用开始`, {
    personCount: requirement.personCount,
    mealType: requirement.mealType,
    caloriePreference: requirement.caloriePreference,
    ingredientCount: ingredients.length,
    seasoningCount: seasonings.length,
  });
  log.info(`API 配置`, { model: aiModel(prefs), thinkingEnabled: prefs.thinkingEnabled });

  log.time('ai_stage1');

  let chunkCount = 0;
  let firstChunk = true;

  return sseStreamFetch(
    url,
    body as unknown as Record<string, unknown>,
    aiHeaders(prefs),
    {
      onReasoning: callbacks.onReasoning,
      onContent: callbacks.onContent,
      onData: () => {
        chunkCount++;
        if (firstChunk) {
          firstChunk = false;
          log.debug('开始接收数据流', { chunkCount });
        }
        callbacks.onData?.();
      },
      onDone: (fullContent: string, fullReasoning: string, _toolCalls?: any) => {
        log.timeEnd('ai_stage1');
        const reasonTail = fullReasoning?.slice(-100) || '(空)';
        log.debug('流结束', { totalChunks: chunkCount, contentLength: fullContent?.length || 0, reasoningLength: fullReasoning?.length || 0, reasoningTail: reasonTail });
        if (!fullContent || fullContent.trim().length === 0) {
          log.error('AI 流式结束但未生成任何内容（只有思考链）');
          callbacks.onError(new Error('AI 未输出有效内容，请重试或关闭思考模式'));
          return;
        }
        try {
          const result = parseStage1Result(JSON.parse(fullContent), fullReasoning);
          const dishCount = result.dishes?.length || 0;
          log.info(`流式调用完成`, { dishCount, totalChunks: chunkCount });
          log.debug('输出统计', { dishCount, prepSteps: result.prepSteps?.length, cookingSteps: result.cookingSteps?.length, preciseNutrition: result.preciseNutrition?.length });
          callbacks.onDone(result);
        } catch {
          log.error('流式返回的 JSON 解析失败');
          log.error('解析失败详情', { contentHead: fullContent?.slice(0, 300), reasoningTail: fullReasoning?.slice(-100) });
          callbacks.onError(new Error('AI 返回格式异常，请检查 API Key 或网络后重试'));
        }
      },
      onError: (error: Error) => {
        log.timeEnd('ai_stage1');
        log.error('流式调用失败', error.message);
        callbacks.onError(error);
      },
    },
    300_000, // 5-minute timeout
  );
}

function buildRegeneratePrompt(
  currentMenu: MenuProposal,
  modifyRequest: string,
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
): string {
  const calorieText = requirement.caloriePreference
    ? `热量目标：每人约${requirement.caloriePreference}大卡`
    : '';
  const customText = requirement.customRequirement ? `特殊需求：${requirement.customRequirement}` : '';

  return `【修改要求】
${modifyRequest}

【原需求】
用餐人数：${requirement.personCount}人
餐类：${requirement.mealType}
${calorieText}
${customText}

【当前完整菜谱 JSON】
${JSON.stringify(currentMenu)}

请根据上述修改要求，输出一份**完整的新菜谱 JSON**，要求：
1. 结构与「当前完整菜谱 JSON」完全一致，所有字段都要包含（dishes、estimatedNutrition、missingItems、prepSteps、cookingSteps、preciseNutrition、summary、cookingOrderDescription、flavorDescription 等）
2. 按修改要求调整 dishes、prepSteps、cookingSteps 等内容
3. 重新计算 estimatedNutrition（总营养）、preciseNutrition（每菜营养）、missingItems（缺料清单）
4. 更新 summary、cookingOrderDescription、flavorDescription 以反映修改
5. 严格 JSON，只返回纯 JSON，禁止任何非 JSON 文本`;
}

/**
 * Regenerate the full menu (used when the user modifies a recipe via AI chat)
 * Takes the current full menu + modification request and outputs a brand-new complete MenuProposal,
 * avoiding partial patches that would desync derived fields such as nutrition/missing items/summary.
 * This call disables thinking mode for faster responses.
 */
export function regenerateMenuStream(
  currentMenu: MenuProposal,
  modifyRequest: string,
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
  prefs: UserPreferences,
  callbacks: {
    onDone: (result: Stage1AIResult) => void;
    onError: (error: Error) => void;
  },
): SSEStreamController {
  const userPrompt = buildRegeneratePrompt(currentMenu, modifyRequest, requirement);
  const url = aiEndpoint(prefs);

  const body = {
    model: aiModel(prefs),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CN },
      { role: 'user', content: userPrompt },
    ],
    thinking: { type: 'disabled' },
    stream: true,
    response_format: { type: 'json_object' },
  };

  log.info('重新生成菜单开始', { modifyRequest: modifyRequest.slice(0, 50) });

  return sseStreamFetch(
    url,
    body as unknown as Record<string, unknown>,
    aiHeaders(prefs),
    {
      onReasoning: () => {},
      onContent: () => {},
      onDone: (fullContent: string) => {
        if (!fullContent || fullContent.trim().length === 0) {
          callbacks.onError(new Error('AI 未输出有效内容，请重试'));
          return;
        }
        try {
          const result = parseStage1Result(JSON.parse(fullContent), '');
          log.info('重新生成菜单完成', { dishCount: result.dishes?.length || 0 });
          callbacks.onDone(result);
        } catch {
          log.error('重新生成的 JSON 解析失败');
          callbacks.onError(new Error('AI 返回格式异常，请重试'));
        }
      },
      onError: (error: Error) => {
        log.error('重新生成菜单失败', error.message);
        callbacks.onError(error);
      },
    },
    120_000, // 2-minute timeout
  );
}
