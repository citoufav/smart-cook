import { z } from 'zod';
import { UserPreferences, ReasoningEffort, CookingSkill, DishPlan, SavedDish } from '../types';
import { sseStreamFetch, SSEStreamController } from '../utils/sseStream';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/maskApiKey';
import { daysSince } from '../utils/daysSince';
import { generateId } from '../utils/uuid';
import { pickNumber, readNumber } from '../utils/looseNumber';
import { MENU_FORMAT_EXAMPLE } from '../constants/menuFormatExample';
import { aiEndpoint, aiHeaders, aiModel } from './aiClient';
import { attachStepsToDishes, recomputeNutrition } from './menuEditService';

const log = logger('SVC:AI');

/** 整份菜单的输出上限。非思考模式默认只有 8K，长菜单会被拦腰截断 */
const MENU_MAX_TOKENS = 32_000;
/** 单道菜的输出上限，正常只要几百 token */
const DISH_MAX_TOKENS = 8_000;
const TRUNCATED_MESSAGE = '输出达到上限被截断：菜品或步骤太多了。试试减少人数/菜数，或在设置里关掉思考模式再试一次。';

// ---------------------------------------------------------------------------
// AI 输出校验（zod）：字段级异常回退默认值（尽力渲染），结构级异常才报错
// ---------------------------------------------------------------------------

/** 数值字段：无法解析/非有限数 → 0 */
const numField = z.coerce.number().transform((v) => (Number.isFinite(v) ? v : 0));

/** 可选字符串字段：非字符串/空串 → undefined */
const optionalStr = z.any().transform((v) => (typeof v === 'string' && v.trim() ? v : undefined));

function readNutrition(raw: any) {
  return {
    calories: readNumber(raw?.calories),
    protein: readNumber(raw?.protein),
    fat: readNumber(raw?.fat),
    carbs: readNumber(raw?.carbs),
  };
}

const dishSchema = z
  .object({
    // 菜名是菜品的身份：既用于显示，也是增删改时定位菜品的主键。
    // 兜底成空串而不是"未命名菜品"——非空兜底值会骗过下游 `if (!name)` 的守卫，
    // 让假菜一路通过（历史 bug：想加个牛奶，结果多出一个"未命名菜品"）。
    // 食材/调料整项都用 z.any() 收下，字段取值交给下面的 normalize* 处理：
    // 数字可能是 "200g"，键名可能被换掉，交给 zod 逐字段强转只会静默变 0。
    name: z.any(),
    ingredients: z.array(z.any()).catch([]),
    seasonings: z.array(z.any()).catch([]),
    estimatedNutrition: z.any(),
  })
  .passthrough();

/** 模型偶尔会把菜名写在同义键上，别因为这个丢掉整道菜 */
function pickDishName(raw: any): string {
  const candidates = [raw?.name, raw?.dishName, raw?.title, raw?.菜名, raw?.dish];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

function normalizeIngredient(raw: any): DishPlan['ingredients'][number] | null {
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const density = pickNumber(raw, ['kcalPer100g', 'caloriesPer100g', 'kcal', 'energyPer100g', '每100克热量']);
  return {
    name,
    estimatedWeight: pickNumber(raw, ['estimatedWeight', 'weight', 'grams', 'gram', '克数', '数量']),
    isInInventory: raw?.isInInventory === true,
    kcalPer100g: density > 0 ? density : undefined,
  };
}

function normalizeSeasoning(raw: any): DishPlan['seasonings'][number] | null {
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const amount = typeof raw?.amount === 'string' ? raw.amount : readNumber(raw?.amount) > 0 ? `${readNumber(raw?.amount)}g` : '';
  const density = pickNumber(raw, ['kcalPer100g', 'caloriesPer100g', 'kcal', 'energyPer100g', '每100克热量']);
  return {
    name,
    amount,
    isInInventory: raw?.isInInventory === true,
    kcalPer100g: density > 0 ? density : undefined,
  };
}

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
    missingItems: z.array(missingItemSchema).catch([]),
    cookingOrderDescription: z.string().catch(''),
    flavorDescription: z.string().catch(''),
    // 复用旧菜时才有：AI 给每道旧菜定的倍数。不收在这里是因为倍数可能是
    // "1.5" 这种字符串，交给 sanitizeScale 统一兜底
    reused: z.array(z.any()).catch([]),
  })
  .passthrough();

/**
 * 校验并规范化 AI 返回的菜谱 JSON，并把 AI 输出的**平铺步骤按菜名挂回各自的菜**。
 *
 * AI 那份 JSON 保持扁平（prepSteps/cookingSteps 带 dishName），因为模型对这个形状
 * 更熟、输出也更省 token；落到本地后统一变成 DishPlan 自包含结构，
 * 之后加菜/删菜/改克数都不用再同步多个平行数组。
 *
 * - 字段级异常回退默认值；结构级异常（根不是对象等）向上抛出
 * - 缺菜名的菜直接丢弃：没名字既显示不了也定位不到
 * - 步骤找不到所属菜品时挂到第一道菜并告警（宁可串菜也不要静默丢步骤）
 */
export function parseStage1Result(raw: unknown, reasoningContent: string): Stage1AIResult {
  const parsed = stage1ResultSchema.parse(raw);

  // 复用旧菜时 AI 会多给一个 reused 数组；没给就是普通生成，空数组自然忽略
  const reused: ReuseScale[] = (parsed.reused as any[])
    .map((r) => ({
      name: String(r?.name ?? '').trim(),
      scale: pickNumber(r, ['scale', 'multiplier', '倍数']),
    }))
    .filter((r) => r.name);

  // 模型偶尔把整道菜直接放在根上（没有 dishes 包一层），照单收下
  let rawDishes: any[] = parsed.dishes;
  if (rawDishes.length === 0 && pickDishName(raw) && Array.isArray((raw as any)?.ingredients)) {
    log.warn('模型把菜品放在了根上，已按单道菜处理');
    rawDishes = [raw];
  }

  const kept: any[] = [];
  for (const d of rawDishes) {
    const name = pickDishName(d);
    if (!name) continue;
    kept.push({ ...d, name });
  }

  const dishes: DishPlan[] = kept.map((d) => ({
    id: generateId(),
    name: d.name as string,
    ingredients: (d.ingredients ?? [])
      .map((i: any) => normalizeIngredient(i))
      .filter((i: DishPlan['ingredients'][number] | null): i is DishPlan['ingredients'][number] => i !== null),
    seasonings: (d.seasonings ?? [])
      .map((s: any) => normalizeSeasoning(s))
      .filter((s: DishPlan['seasonings'][number] | null): s is DishPlan['seasonings'][number] => s !== null),
    estimatedNutrition: readNutrition(d.estimatedNutrition),
    prepSteps: [],
    cookingSteps: [],
  }));

  if (dishes.length < rawDishes.length) {
    // 把模型实际给的字段留下来，下次再出这种毛病能直接看出它写成了什么
    log.warn('已丢弃缺少菜名的菜品', {
      dropped: rawDishes.length - dishes.length,
      shape: JSON.stringify(rawDishes).slice(0, 400),
    });
  }
  for (const d of dishes) {
    if (d.ingredients.length > 0 && !d.ingredients.some((i) => i.estimatedWeight > 0)) {
      log.warn('菜品所有食材克数都是 0', {
        dish: d.name,
        shape: JSON.stringify(rawDishes.find((x) => pickDishName(x) === d.name) ?? {}).slice(0, 400),
      });
    }
  }
  if (dishes.length === 0) {
    return {
      dishes,
      reused,
      missingItems: parsed.missingItems,
      reasoningContent,
      summary: parsed.summary,
      cookingOrderDescription: parsed.cookingOrderDescription,
      flavorDescription: parsed.flavorDescription,
    };
  }

  // 把 AI 输出的扁平步骤按 dishName 挂回各自的菜
  const orphans = attachStepsToDishes(dishes, parsed.prepSteps, parsed.cookingSteps);
  if (orphans > 0) {
    log.warn('有步骤找不到所属菜品，已挂到第一道菜', { orphans });
  }

  // 热量以「克数 × 每100克大卡」为准，模型给的 estimatedNutrition 只当兜底
  return {
    dishes: dishes.map(recomputeNutrition),
    reused,
    missingItems: parsed.missingItems,
    reasoningContent,
    summary: parsed.summary,
    cookingOrderDescription: parsed.cookingOrderDescription,
    flavorDescription: parsed.flavorDescription,
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

export const SYSTEM_PROMPT_CN = `你是一位专业的家庭厨师和营养顾问。请严格遵循以下规则。

【基本规则】
1. 优先消耗库存：首先使用库存中已有的食材和调料。
2. 最小化采买：尽量减少需要额外购买的食材和调料。
3. 统一单位：所有食材重量单位为"克"（g），调料在菜单规划阶段可用"适量/少许"等描述，在炒制步骤中必须给克重数字。
4. 严格 JSON：只返回纯 JSON，禁止用 \`\`\`json\`\`\` 包裹，禁止输出任何非 JSON 文本。
5. 全局一致性：生成前先通盘考虑备菜→炒制全流程，确保步骤衔接无矛盾。
6. 主食=菜品：米饭、馒头、面条、花卷、烙饼等主食与炒菜一样是独立菜品，必须包含在 dishes 中，有独立的 estimatedNutrition。
7. **每个食材和调料都必须给 kcalPer100g**（每 100 克多少大卡），按中国食物成分表口径、生重计算。
   参考值：大米 346、面粉 366、鸡蛋 143、番茄 20、猪肉(瘦) 143、牛肉(瘦) 106、鸡胸肉 133、
   食用油 899、白砂糖 400、牛奶 54、豆腐 82、清水 0。盐、清水这类没有热量的写 0。
   客户端会用「克数 × kcalPer100g ÷ 100」自己算总热量，所以这个数字必须给对；
   estimatedNutrition 仍然要填，它应该和"克数×密度"算出来的基本一致（差太多说明密度给错了）。

【营养与搭配】
8. 热量以用户消息里的「热量目标」为准。只有那里写"不限"时，才用这组默认区间：
   成年男性 600-800 大卡/餐，成年女性 500-600 大卡/餐。
9. 早餐 300-500 大卡，20 分钟内可完成（同样只在没有热量目标时作为参考）。
10. 午餐/晚餐根据人数和热量目标合理搭配，荤素搭配，有主食。
11. 中餐为主，1人份主料 150-300g。

【备菜步骤 — 重要】
12. 备菜按菜品分组，不跨菜合并：每道菜的备菜步骤各写各的，dishName 必须填。
    同一食材被两道菜用到时，分别在各自的步骤里写各自的用量（见范例里番茄的两条）。
    ❌ 禁止：把两道菜的番茄合成一条 "取[番茄(300g)]洗净切块"（用户做了一个菜就不知道该切多少）
13. 同一道菜内部，相同食材、相同切配方式仍然合并为一条（避免重复劳动）。

【炒制步骤 — 重要】
14. 描述写到多细，按用户消息里的【烹饪熟练度】执行——那里说了要写多细就写多细。
    唯一不可省略的是用量：食材和调料一律写克重，任何熟练度都一样。
    煮米饭等需要加水的操作，无论哪一档都要写确切水量，如"加入清水300g，大火煮沸后转小火焖15分钟"。
15. cookingSteps 按 summary.cookingOrder 的顺序排列，stepNumber 从 1 连续递增。
16. instruction 中用 [食材名(克重)] 引用食材。只要调料出现在 instruction 里，就必须是确切克重：
    油类、酱油、醋、料酒、盐、糖、淀粉等一律用 [调料名(Xg)]，禁止"适量/少许/X勺"。
    粉状调料（花椒粉、胡椒粉、十三香等）可用 1-5g 范围。

【其他规则】
17. dishes[].seasonings[].amount 写用量即可，允许"适量/少许"这类描述（那是给用户看采购清单的）。
18. 食材不足时 dishes 数组不能为空，至少给出 1 道利用现有食材的简易菜（蛋炒饭、拌面、炒时蔬等）。
19. missingItems 只放库存里没有的东西（isInInventory 为 false 的），type 只能是 "ingredient" 或 "seasoning"。
20. 所有输出使用中文。

【输出格式】
照下面这份范例返回。**字段名、层级、数字写法一个都不能少、不能改名**；
菜品内容当然要按用户需求来（范例只是格式示范，不要照抄菜品）。

${MENU_FORMAT_EXAMPLE}`;

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

const STATUS_LABEL: Record<string, string> = { sufficient: '充足', low: '少量', out: '缺少' };

function formatIngredientLines(
  ingredients: { name: string; weight: number | null; createDate: string }[],
): string {
  if (ingredients.length === 0) return '库存中暂无食材。';
  return [...ingredients]
    .sort((a, b) => new Date(a.createDate).getTime() - new Date(b.createDate).getTime())
    .map((ing, i) => {
      const days = daysSince(ing.createDate);
      return `${i + 1}. ${ing.name}：${ing.weight !== null ? ing.weight + '克' : '重量未知'}（已存放${days}天）`;
    })
    .join('\n');
}

function formatSeasoningLines(seasonings: { name: string; status: string }[]): string {
  if (seasonings.length === 0) return '库存中暂无调料记录。';
  return seasonings.map((s) => `- ${s.name}：${STATUS_LABEL[s.status] || s.status}`).join('\n');
}

/**
 * 把勾选的旧菜压成几行给它看。
 *
 * **刻意不给步骤文案**：决定倍数只需要知道是什么菜、用什么、多少量，
 * 步骤会白烧几千 token 的输出等价值。代价是模型看不出"这道菜是不是用大锅炖的"，
 * 只能从菜名和用料猜 —— 这个代价是明知接受的。
 */
function formatReusedDishLines(saved: SavedDish[]): string {
  return saved
    .map((d) => {
      const main = d.ingredients.map((i) => `${i.name}${i.estimatedWeight}g`).join('、');
      const sea = d.seasonings.map((s) => `${s.name}${s.amount ?? ''}`).join('、');
      return `- ${d.name}｜当初 ${d.basePersonCount} 人份｜${d.estimatedNutrition?.calories ?? 0} 大卡｜${main}${sea ? `｜调料：${sea}` : ''}`;
    })
    .join('\n');
}

/**
 * 复用旧菜时追加的一段。它要能**推翻**系统提示里"dishes 至少 1 道菜"那条 ——
 * 勾了 3 道已经是整桌菜的时候，AI 一道新的都不该出。
 */
function buildReuseSection(
  reused: SavedDish[],
  requirement: { personCount: number; caloriePreference?: number },
): string {
  const already = reused.reduce((n, d) => n + (d.estimatedNutrition?.calories ?? 0), 0);
  const target = requirement.caloriePreference
    ? requirement.caloriePreference * requirement.personCount
    : 0;
  const gapText = target > 0
    ? `已选这些菜合计 ${already} 大卡（当年的人数份量），本次 ${requirement.personCount} 人目标共 ${target} 大卡，缺口约 ${Math.max(0, target - already)} 大卡。`
    : `已选这些菜合计 ${already} 大卡（当年的人数份量）。`;

  return `
【这次有几道菜是复用旧菜谱】
用户从"做过的菜"里勾了 ${reused.length} 道，菜谱原样沿用，**不要重写它们的配料和步骤**。
${formatReusedDishLines(reused)}
${gapText}

你来当主厨，定两件事：

A. 每道旧菜这次做多少 —— 给一个倍数 scale（1 = 原样，1.5 = 一倍半，2 = 两倍）。
   几个人吃多少你说了算，**没有上下限，也不要求跟人数成正比**。
   唯一的物理约束是真的：家用炒锅塞不下就翻不开、变成煮菜，这种时候宁可少放大、多加一道菜；
   炖菜、汤、主食没这个限制，可以按人数放开。

B. 还要不要再加菜 —— 加几道、加什么，你定。**可以一道都不加**（勾的菜已经够一桌了）。
   只输出新加的菜，「主食=菜品」照旧：米饭这类不在旧菜里，需要就自己加。

返回的 JSON 要多一个 reused 数组，name 必须和上面列出的菜名一字不差：
"reused": [{"name": "青椒肉丝", "scale": 1.5}, {"name": "番茄蛋花汤", "scale": 2}]
必须每道旧菜都有一条。如果一道新菜都不加，dishes 返回空数组 [] 即可。`;
}

function buildStage1UserPrompt(
  ingredients: { name: string; weight: number | null; createDate: string }[],
  seasonings: { name: string; status: string }[],
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
  dietaryRestrictions: string[],
  recentMeals?: string[],
  tastePreferences: string[] = [],
  cookingSkill: CookingSkill = 'beginner',
  reused: SavedDish[] = [],
): string {
  const ingredientLines = formatIngredientLines(ingredients);
  const seasoningLines = formatSeasoningLines(seasonings);

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
${reused.length > 0 ? buildReuseSection(reused, requirement) : ''}
${reused.length > 0
    ? '其他字段照系统提示里的范例格式返回，每道新菜都要有 name。'
    : '请照系统提示里的范例格式返回。确保 dishes 数组至少 1 道菜、每道菜都有 name；范例里那两道菜只是格式示范，别照抄。'}`;
}

/** 复用旧菜时，AI 为每道旧菜定的倍数（1 = 原样，1.5 = 一倍半） */
export interface ReuseScale {
  name: string;
  scale: number;
}

export interface Stage1AIResult {
  dishes: DishPlan[];
  /** 只有复用旧菜时才非空 */
  reused: ReuseScale[];
  missingItems: any[];
  reasoningContent: string;
  summary?: any;
  cookingOrderDescription?: string;
  flavorDescription?: string;
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
  reused: SavedDish[] = [],
): SSEStreamController {
  const userPrompt = buildStage1UserPrompt(ingredients, seasonings, requirement, dietaryRestrictions, recentMeals, prefs.tastePreferences, prefs.cookingSkill, reused);
  const url = aiEndpoint(prefs);

  const body = {
    model: aiModel(prefs),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CN },
      { role: 'user', content: userPrompt },
    ],
    ...buildThinkingConfig(prefs),
    stream: true,
    // 不设这个时非思考模式只有 8K 输出，长菜单会被拦腰截断，
    // 然后 JSON.parse 失败被误报成"格式异常"。384K 是模型上限，写 32K 足够。
    max_tokens: MENU_MAX_TOKENS,
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
      onDone: (fullContent: string, fullReasoning: string, _toolCalls?: any, finishReason?: string) => {
        log.timeEnd('ai_stage1');
        const reasonTail = fullReasoning?.slice(-100) || '(空)';
        log.debug('流结束', { totalChunks: chunkCount, contentLength: fullContent?.length || 0, reasoningLength: fullReasoning?.length || 0, reasoningTail: reasonTail, finishReason });
        if (finishReason === 'length') {
          log.error('输出被截断（finish_reason=length）');
          callbacks.onError(new Error(TRUNCATED_MESSAGE));
          return;
        }
        if (!fullContent || fullContent.trim().length === 0) {
          log.error('AI 流式结束但未生成任何内容（只有思考链）');
          callbacks.onError(new Error('AI 未输出有效内容，请重试或关闭思考模式'));
          return;
        }
        try {
          const result = parseStage1Result(JSON.parse(fullContent), fullReasoning);
          const dishCount = result.dishes?.length || 0;
          // 复用模式下"一道新菜都不加"是合法结果（勾的菜已经够一桌），不能当失败
          const reusedCount = result.reused?.length || 0;
          if (dishCount === 0 && reusedCount === 0) {
            log.error('AI 未返回任何可用菜品');
            callbacks.onError(new Error('AI 没有返回任何菜品，请重试'));
            return;
          }
          log.info(`流式调用完成`, { dishCount, reusedCount, totalChunks: chunkCount });
          log.debug('输出统计', {
            dishCount,
            prepSteps: result.dishes.reduce((n, d) => n + d.prepSteps.length, 0),
            cookingSteps: result.dishes.reduce((n, d) => n + d.cookingSteps.length, 0),
          });
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


// ---------------------------------------------------------------------------
// 单菜生成（对话改菜谱用）
// ---------------------------------------------------------------------------

/**
 * 一次只产出一道菜。对话里「换一道菜 / 加一道菜」走这里，
 * 输出量只有几百 token，不会撞上 max_tokens 导致整段 JSON 被截断。
 */
export function generateOneDishStream(
  instruction: string,
  mode: 'add' | 'replace',
  context: {
    dishNames: string[];
    ingredients: { name: string; weight: number | null; createDate: string }[];
    seasonings: { name: string; status: string }[];
    requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string };
    dietaryRestrictions: string[];
    tastePreferences: string[];
    cookingSkill: CookingSkill;
  },
  prefs: UserPreferences,
  callbacks: { onDone: (dish: DishPlan) => void; onError: (error: Error) => void },
): SSEStreamController {
  const url = aiEndpoint(prefs);
  const userPrompt = buildOneDishPrompt(instruction, mode, context);

  const body = {
    model: aiModel(prefs),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CN },
      { role: 'user', content: userPrompt },
    ],
    thinking: { type: 'disabled' as const },
    stream: true,
    max_tokens: DISH_MAX_TOKENS,
    response_format: { type: 'json_object' },
  };

  log.info('单菜生成开始', { mode, instruction: instruction.slice(0, 50) });

  return sseStreamFetch(
    url,
    body as unknown as Record<string, unknown>,
    aiHeaders(prefs),
    {
      onReasoning: () => {},
      onContent: () => {},
      onDone: (fullContent: string, _reasoning: string, _toolCalls?: any, finishReason?: string) => {
        if (finishReason === 'length') {
          callbacks.onError(new Error(TRUNCATED_MESSAGE));
          return;
        }
        if (!fullContent || !fullContent.trim()) {
          callbacks.onError(new Error('AI 未输出有效内容，请重试'));
          return;
        }
        try {
          const parsed = parseStage1Result(JSON.parse(fullContent), '');
          const dish = parsed.dishes?.[0];
          if (!dish) {
            callbacks.onError(new Error('AI 没有给出菜品，请换个说法再试'));
            return;
          }
          if (!dish.ingredients?.length) {
            callbacks.onError(new Error('AI 给的菜没有食材，请说得更具体一点'));
            return;
          }
          // 全是 0 克的"菜"没有意义：采买清单会建议买 0g，热量也永远是 0
          if (!dish.ingredients.some((i) => i.estimatedWeight > 0)) {
            callbacks.onError(new Error('AI 给的食材没有克数，请换个说法再试'));
            return;
          }
          log.info('单菜生成完成', {
            dish: dish.name,
            prepSteps: dish.prepSteps.length,
            cookingSteps: dish.cookingSteps.length,
          });
          callbacks.onDone(dish);
        } catch {
          log.error('单菜生成的 JSON 解析失败');
          callbacks.onError(new Error('AI 返回格式异常，请重试'));
        }
      },
      onError: (error: Error) => {
        log.error('单菜生成失败', error.message);
        callbacks.onError(error);
      },
    },
    120_000,
  );
}

function buildOneDishPrompt(
  instruction: string,
  mode: 'add' | 'replace',
  context: {
    dishNames: string[];
    ingredients: { name: string; weight: number | null; createDate: string }[];
    seasonings: { name: string; status: string }[];
    requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string };
    dietaryRestrictions: string[];
    tastePreferences: string[];
    cookingSkill: CookingSkill;
  },
): string {
  const r = context.requirement;
  const calorieText = r.caloriePreference
    ? `热量目标：每人约${r.caloriePreference}大卡`
    : '热量目标：不限';
  const customText = r.customRequirement ? `特殊需求：${r.customRequirement}` : '';
  const restrictionText = context.dietaryRestrictions.length > 0 ? `忌口：${context.dietaryRestrictions.join(', ')}` : '';
  const tasteText = context.tastePreferences.length > 0 ? `口味与菜系偏好：${context.tastePreferences.join(', ')}` : '';

  return `【本次任务】${mode === 'add' ? '新增' : '替换'}一道菜：${instruction}

【已有菜品】（不要与这些重复）
${context.dishNames.join('、') || '无'}

【基本信息】
用餐人数：${r.personCount}人
餐类：${r.mealType}
${calorieText}
${customText}
${restrictionText}
${tasteText}

【烹饪熟练度】
${SKILL_DETAIL_PROMPT[context.cookingSkill] || SKILL_DETAIL_PROMPT.beginner}

【库存食材】
${formatIngredientLines(context.ingredients)}

【库存调料】
${formatSeasoningLines(context.seasonings)}

【输出要求】
**只输出 1 道菜**：照系统提示里那份范例的字段和写法来，但 dishes 数组里只放 1 个元素
（范例里有 2 道，你只写 1 道），prepSteps / cookingSteps / missingItems 也只写这道菜的。

三个硬性要求，缺一个这份输出就不合格：
1. 那道菜必须有 name（菜名），不能省略、不能为空。
2. 每个食材必须有 estimatedWeight：整数克数（${r.personCount} 人份的用量），写成数字 200，不要写成 "200g" 这种字符串。
3. 每个食材/调料必须有 kcalPer100g：每 100 克多少大卡（大米346 / 鸡蛋143 / 食用油899 / 牛奶54 / 蔬菜15~40）。
   estimatedWeight 和 kcalPer100g 是两件事：前者是"用多少克"，后者是"每 100 克多少大卡"，不能只给一个。
   estimatedNutrition 仍要给，客户端会用它和"克数×密度"交叉校验。`;
}
