import { z } from 'zod';
import { UserPreferences, MenuProposal, ReasoningEffort, CookingSkill } from '../types';
import { sseStreamFetch, SSEStreamController } from '../utils/sseStream';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/maskApiKey';
import { daysSince } from '../utils/daysSince';
import { aiEndpoint, aiHeaders, aiModel } from './aiClient';

const log = logger('SVC:AI');

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

function buildThinkingConfig(prefs: UserPreferences): { thinking: { type: 'enabled' | 'disabled' }; reasoning_effort?: ReasoningEffort } {
  if (prefs.thinkingEnabled) {
    return {
      thinking: { type: 'enabled' },
      reasoning_effort: prefs.reasoningEffort,
    };
  }
  return { thinking: { type: 'disabled' } };
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
7. 热量以用户消息里的「热量目标」为准。只有那里写"不限"时，才用这组默认区间：
   成年男性 600-800 大卡/餐，成年女性 500-600 大卡/餐。
8. 早餐 300-500 大卡，20 分钟内可完成（同样只在没有热量目标时作为参考）。
9. 午餐/晚餐根据人数和热量目标合理搭配，荤素搭配，有主食。
10. 中餐为主，1人份主料 150-300g。

【备菜步骤 — 重要】
11. 备菜按菜品分组，不跨菜合并：每道菜的备菜步骤各写各的，dishName 必须填。
    同一食材被两道菜用到时，分别在各自的步骤里写各自的用量。
    ✅ 正确：番茄炒蛋 → "取[番茄(200g)]洗净切块"；紫菜蛋花汤 → "取[番茄(100g)]切丁"（两条，各自属于对应菜品）
    ❌ 错误：把两道菜的番茄合成一条 "取[番茄(300g)]洗净切块"（用户做了一个菜就不知道该切多少）
12. 同一道菜内部，相同食材、相同切配方式仍然合并为一条（避免重复劳动）。
    ✅ 正确：番茄炒蛋用不到两次番茄 → 只写 "取[番茄(200g)]洗净切块" 一条
13. prepSteps 格式：每条包含 id("prep-N")、ingredientName(食材名)、quantity(用量如"200g")、dishName(所属菜品名)、description(操作描述)、isCompleted(false)、order(从1递增)。
    description 中用 [食材名(克重)] 引用食材。
    ✅ 正确："淘洗[大米(200g)]，换水浸泡20分钟后沥干"

【炒制步骤 — 重要】
14. 描述写到多细，按用户消息里的【烹饪熟练度】执行——那里说了要写多细就写多细。
    唯一不可省略的是用量：食材和调料一律写克重，任何熟练度都一样。
    煮米饭等需要加水的操作，无论哪一档都要写确切水量，如"加入清水300g，大火煮沸后转小火焖15分钟"。
15. cookingSteps.instruction 中用 [食材名(克重)] 引用食材。
    ✅ 正确："将[猪肉丝(150g)]倒入锅中，加入[清水(300g)]，大火煮沸"
16. cookingSteps 格式：每条包含 stepNumber(从1递增)、dishName(对应菜品名)、instruction(炒制说明)、isCompleted(false)。

【其他规则】
17. dishes[].seasonings[].amount 写用量即可，允许"适量/少许"这类描述（那是给用户看采购清单的）。
    但只要调料出现在 cookingSteps.instruction 里，就必须是确切克重：油类、酱油、醋、料酒、盐、糖、淀粉等一律用 [调料名(Xg)]，禁止"适量/少许/X勺"。
    粉状调料（花椒粉、胡椒粉、十三香等）可用 1-5g 范围。
18. 食材不足时 dishes 数组不能为空，至少给出 1 道利用现有食材的简易菜（蛋炒饭、拌面、炒时蔬等）。
19. 所有输出使用中文。`;

/** 熟练度 → 描述详细程度。用量克重不在其中，任何档位都必须写。 */
export const SKILL_DETAIL_PROMPT: Record<CookingSkill, string> = {
  beginner:
    '新手：每一步都要写清火候（如"六成热，约160°C"）、时长（如"大火煮沸后转小火焖15分钟"）、以及怎么判断（如"至边缘金黄"）。'
    + '禁止"水米比例1:1.2""油温适中""适量加水""焖至熟"这类无法照着做的描述。',
  intermediate:
    '家常：火候和时长给范围即可（如"中火3-5分钟"），关键判断点写清楚；不必逐句标温度和克重之外的细节。',
  experienced:
    '熟练：只写操作顺序和关键配料，火候、时长、手法可以省略。'
    + '但用量必须照常写克重（[食材名(Xg)]），系统要靠它扣库存。',
};

function buildStage1UserPrompt(
  ingredients: { name: string; weight: number | null; createDate: string }[],
  seasonings: { name: string; status: string }[],
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
  dietaryRestrictions: string[],
  recentMeals?: string[],
  tastePreferences: string[] = [],
  cookingSkill: CookingSkill = 'beginner',
): string {
  const statusLabel: Record<string, string> = { sufficient: '充足', low: '少量', out: '缺少' };

  const ingredientLines = ingredients.length > 0
    ? ingredients
        .sort((a, b) => new Date(a.createDate).getTime() - new Date(b.createDate).getTime())
        .map((ing, i) => {
          const days = daysSince(ing.createDate);
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

【烹饪熟练度】
${SKILL_DETAIL_PROMPT[cookingSkill] || SKILL_DETAIL_PROMPT.beginner}

【库存食材】
${ingredientLines}

【库存调料】
${seasoningLines}

请严格按照以下 JSON Schema 返回，确保 dishes 数组至少包含 1 道菜品。

【prepSteps 生成规则】
- 按菜品分组：每道菜自己的备菜步骤，dishName 必须填，不要跨菜合并
- 同一道菜内，相同食材 + 相同切配方式才合并为一条
- description 中用 [食材名(克重)] 引用食材
- 示例：番茄炒蛋 → "取[番茄(200g)]洗净切块"；汤 → "取[番茄(100g)]切丁"（两条，分属两道菜）

【cookingSteps 生成规则】
- 按 cookingOrder 建议的顺序排列步骤，stepNumber 从 1 递增
- instruction 中用 [食材名(克重)] 引用食材
- 油、水、调料必须写确切克数，如 [食用油(10g)]、[清水(300g)]
- missingItems[].type 只能是 "ingredient" 或 "seasoning"（下面示例里写的是 ingredient）

JSON Schema（数字与布尔按此写法，不要写成"克数""true或false"这类描述）：

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
        { "name": "食材名", "estimatedWeight": 200, "isInInventory": true }
      ],
      "seasonings": [
        { "name": "调料名", "amount": "用量描述", "isInInventory": true }
      ],
      "estimatedNutrition": { "calories": 350, "protein": 20, "fat": 12, "carbs": 40 }
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
    { "calories": 350, "protein": 20, "fat": 12, "carbs": 40 }
  ],
  "missingItems": [
    { "type": "ingredient", "name": "名称", "suggestedAmount": "建议购买量", "forDish": "用于菜品名" }
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
  const userPrompt = buildStage1UserPrompt(ingredients, seasonings, requirement, dietaryRestrictions, recentMeals, prefs.tastePreferences, prefs.cookingSkill);
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
  cookingSkill: CookingSkill = 'beginner',
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

【烹饪熟练度】
${SKILL_DETAIL_PROMPT[cookingSkill] || SKILL_DETAIL_PROMPT.beginner}

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
  const userPrompt = buildRegeneratePrompt(currentMenu, modifyRequest, requirement, prefs.cookingSkill);
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
