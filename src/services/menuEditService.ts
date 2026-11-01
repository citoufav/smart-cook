import type {
  MenuProposal,
  DishPlan,
  DishNutrition,
  RequirementInput,
  NutritionInfo,
  ShoppingItem,
} from '../types';

/**
 * 菜品 id。
 *
 * 故意不去 import utils/uuid：scripts/check-menu-edits.mjs 用 Node 的类型擦除直接
 * 跑这个文件，而 Node 的 ESM 解析要求相对导入带 .ts 后缀（tsconfig 又不允许，
 * Metro 也不需要）。这里只需要"同一份菜单内不重复"，四行本地实现比给一个
 * 纯工具函数加扩展名省事。
 */
function newDishId(): string {
  return `dish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 菜单的最小编辑动作。
 *
 * 这些动作**全部在本地确定性执行**，不调模型：用户点界面上的按钮、改个数字，
 * 立刻能看到结果。只有"加一道菜"需要 AI，因为那确实是要创造新内容。
 *
 * 因为一道菜是自包含的（步骤就在菜里），增删菜不再需要去同步别的数组，
 * 只剩"改克数时把步骤文案里的同一个数字也改掉"这一件需要人管的事。
 */
export type MenuEdit =
  | { op: 'set_grams'; dish: string; ingredient: string; grams: number }
  | { op: 'add_ingredient'; dish: string; ingredient: string; grams: number }
  | { op: 'remove_ingredient'; dish: string; ingredient: string }
  | { op: 'set_seasoning_amount'; dish: string; seasoning: string; amount: string }
  | { op: 'rename_dish'; dish: string; newName: string }
  | { op: 'remove_dish'; dish: string }
  | { op: 'set_person_count'; personCount: number }
  | { op: 'replace_dish'; dish: string; generated: DishPlan }
  | { op: 'add_dish'; generated: DishPlan };

const ZERO_NUTRITION: DishNutrition = { calories: 0, protein: 0, fat: 0, carbs: 0 };

// ---------------------------------------------------------------------------
// 文本里的 [食材(Ng)] 重写
// ---------------------------------------------------------------------------

const GRAM_TAG_RE = /\[([^\[\]（）()]+?)[（(](\d+(?:\.\d+)?)\s*(?:g|克)[）)]\]/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把文本里指定食材的克重改写为 grams；其他食材不动 */
function setGramsInText(text: string, ingredient: string, grams: number): string {
  const re = new RegExp(
    `\\[${escapeRegExp(ingredient)}[（(](\\d+(?:\\.\\d+)?)\\s*(?:g|克)[）)]\\]`,
    'g',
  );
  return text.replace(re, `[${ingredient}(${grams}g)]`);
}

/** 删掉文本里指定食材的整个标签 */
function removeTagFromText(text: string, ingredient: string): string {
  const re = new RegExp(`\\[${escapeRegExp(ingredient)}[（(][^）)]*[）)]\\]`, 'g');
  return text.replace(re, ingredient);
}

/** 按比例缩放文本里所有 [食材(Ng)]，人数变化时用 */
function scaleGramsInText(text: string, factor: number): string {
  if (factor === 1) return text;
  return text.replace(GRAM_TAG_RE, (_m, name: string, num: string) => {
    const scaled = Math.max(1, Math.round(parseFloat(num) * factor));
    return `[${name}(${scaled}g)]`;
  });
}

/** prepSteps.quantity / 调料 amount 形如 "200g"，按比例缩放；"适量" 这类原样返回 */
export function scaleGramAmount(amount: string, factor: number): string {
  if (factor === 1) return amount;
  const m = /^约?\s*(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)?\s*(左右)?$/.exec((amount || '').trim());
  if (!m) return amount;
  const scaled = Math.max(1, Math.round(parseFloat(m[1]) * factor));
  return `${scaled}${m[2] || 'g'}${m[3] || ''}`;
}

function scaleNutrition(n: DishNutrition | undefined, factor: number): DishNutrition {
  if (!n) return { ...ZERO_NUTRITION };
  return {
    calories: Math.round(n.calories * factor),
    protein: Math.round(n.protein * factor),
    fat: Math.round(n.fat * factor),
    carbs: Math.round(n.carbs * factor),
  };
}

/** 把「10g」「10 克」「约10ml」这类用量解析成克数；解析不出（适量/1汤匙）就返回 0 */
function parseGramAmount(amount: string): number {
  const m = /^约?\s*(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)?\s*(左右)?$/.exec((amount || '').trim());
  return m ? parseFloat(m[1]) : 0;
}

/**
 * 按「克数 × 每100克大卡 ÷ 100」算这道菜的热量。
 * 解析不出克数的调料（"适量""1汤匙"）不计入，宁可略低也不要瞎猜。
 *
 * ponytail: 调料只认 g/克/ml/毫升 这类明确单位，要更准就得让模型给确切克数。
 */
export function computeCalories(dish: DishPlan): { kcal: number; covered: number } {
  let kcal = 0;
  let covered = 0;

  for (const i of dish.ingredients) {
    const density = i.kcalPer100g ?? 0;
    if (density > 0) {
      kcal += (i.estimatedWeight * density) / 100;
      covered++;
    }
  }
  for (const s of dish.seasonings) {
    const density = s.kcalPer100g ?? 0;
    if (density <= 0) continue;
    const grams = parseGramAmount(s.amount);
    if (grams > 0) {
      kcal += (grams * density) / 100;
      covered++;
    }
  }

  return { kcal, covered };
}

/**
 * 由克数算出这道菜的热量，写回 estimatedNutrition。
 *
 * 只在至少一个食材带了 kcalPer100g 时才动手；老数据没有密度，就保留模型给的估算。
 * 蛋白/脂肪/碳水不做独立计算（那要为每个食材再要三个密度，token 翻几倍），
 * 而是按热量变化同比缩放，保证四项互相自洽 —— 反正这份估算本身就有 ±20% 误差。
 */
export function recomputeNutrition(dish: DishPlan): DishPlan {
  const { kcal, covered } = computeCalories(dish);
  if (covered === 0) return dish;

  const calories = Math.round(kcal);
  const base = dish.estimatedNutrition ?? ZERO_NUTRITION;
  const factor = base.calories > 0 ? calories / base.calories : 1;
  return {
    ...dish,
    estimatedNutrition: {
      calories,
      protein: Math.round(base.protein * factor),
      fat: Math.round(base.fat * factor),
      carbs: Math.round(base.carbs * factor),
    },
  };
}

/** 所有食材都带密度 = 热量是按克数实算的，可以标"精确" */
export function hasFullDensity(dish: DishPlan): boolean {
  return dish.ingredients.length > 0 && dish.ingredients.every((i) => (i.kcalPer100g ?? 0) > 0);
}

export function sumNutrition(dishes: DishPlan[]): NutritionInfo {
  return dishes.reduce<NutritionInfo>(
    (sum, d) => ({
      calories: sum.calories + (d.estimatedNutrition?.calories || 0),
      protein: sum.protein + (d.estimatedNutrition?.protein || 0),
      fat: sum.fat + (d.estimatedNutrition?.fat || 0),
      carbs: sum.carbs + (d.estimatedNutrition?.carbs || 0),
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

function cloneDish(d: DishPlan): DishPlan {
  return {
    ...d,
    ingredients: (d.ingredients ?? []).map((i) => ({ ...i })),
    seasonings: (d.seasonings ?? []).map((s) => ({ ...s })),
    estimatedNutrition: { ...(d.estimatedNutrition ?? ZERO_NUTRITION) },
    prepSteps: (d.prepSteps ?? []).map((s) => ({ ...s })),
    cookingSteps: (d.cookingSteps ?? []).map((s) => ({ ...s })),
  };
}

function findDish(dishes: DishPlan[], name: string): DishPlan | undefined {
  const target = name.trim();
  return dishes.find((d) => d.name.trim() === target);
}

// ---------------------------------------------------------------------------
// 形状：把 AI 的扁平步骤挂进菜 / 迁移老数据
// ---------------------------------------------------------------------------

export interface FlatPrepStep {
  id?: string;
  ingredientName?: string;
  quantity?: string;
  description?: string;
  dishName?: string;
  isCompleted?: boolean;
}

export interface FlatCookingStep {
  instruction?: string;
  dishName?: string;
  isCompleted?: boolean;
}

/**
 * 把带 dishName 的扁平步骤挂进各自的菜，并按菜内顺序重新编号。
 *
 * AI 那份 JSON 保持扁平（模型对它更熟、输出更省 token），落到本地后统一
 * 变成自包含结构。找不到所属菜品时挂到第一道菜并告警——宁可串菜也别静默丢步骤。
 *
 * @returns 挂错菜的步骤条数，供调用方打日志
 */
export function attachStepsToDishes(
  dishes: DishPlan[],
  prepSteps: FlatPrepStep[],
  cookingSteps: FlatCookingStep[],
): number {
  if (dishes.length === 0) return 0;
  const byName = new Map(dishes.map((d) => [d.name.trim(), d]));
  const fallback = dishes[0];
  let orphans = 0;

  for (const s of prepSteps) {
    const host = byName.get((s.dishName ?? '').trim());
    if (!host) orphans++;
    (host ?? fallback).prepSteps.push({
      id: s.id ?? '',
      ingredientName: s.ingredientName ?? '',
      quantity: s.quantity ?? '',
      description: s.description ?? '',
      // 老数据里已经切好的菜要保留勾选进度，迁移不能把进度清零
      isCompleted: s.isCompleted === true,
      order: 0,
    });
  }

  for (const s of cookingSteps) {
    const host = byName.get((s.dishName ?? '').trim());
    if (!host) orphans++;
    (host ?? fallback).cookingSteps.push({
      stepNumber: 0,
      instruction: s.instruction ?? '',
      isCompleted: s.isCompleted === true,
    });
  }

  for (const dish of dishes) {
    dish.prepSteps = dish.prepSteps.map((s, i) => ({
      ...s,
      id: s.id || `prep-${i + 1}`,
      order: i + 1,
    }));
    dish.cookingSteps = dish.cookingSteps.map((s, i) => ({ ...s, stepNumber: i + 1 }));
  }

  return orphans;
}

/** 新建一道空菜（只有名字和食材，步骤为空） */
export function createDish(input: {
  name: string;
  ingredients: DishPlan['ingredients'];
  seasonings?: DishPlan['seasonings'];
  estimatedNutrition?: DishNutrition;
}): DishPlan {
  return {
    id: newDishId(),
    name: input.name.trim(),
    ingredients: [...input.ingredients],
    seasonings: [...(input.seasonings ?? [])],
    estimatedNutrition: { ...(input.estimatedNutrition ?? ZERO_NUTRITION) },
    prepSteps: [],
    cookingSteps: [],
  };
}

/**
 * 把存下来的菜单规范化成当前结构。
 *
 * 老版本把备菜/炒制步骤和营养放在菜单级的平行数组里（靠 dishName / 下标挂靠），
 * 这里把它们搬进各自的菜，保证进行中的菜单升级后不丢进度。
 */
export function migrateMenuProposal(raw: any): MenuProposal | undefined {
  if (!raw || !Array.isArray(raw.dishes)) return undefined;

  const legacyPrep: FlatPrepStep[] = Array.isArray(raw.prepSteps) ? raw.prepSteps : [];
  const legacyCooking: FlatCookingStep[] = Array.isArray(raw.cookingSteps) ? raw.cookingSteps : [];

  const dishes: DishPlan[] = raw.dishes
    .filter((d: any) => d && typeof d.name === 'string' && d.name.trim())
    .map((d: any, i: number) => {
      const alreadyNested = Array.isArray(d.prepSteps) && Array.isArray(d.cookingSteps);
      return {
        id: typeof d.id === 'string' && d.id ? d.id : newDishId(),
        name: d.name.trim(),
        ingredients: Array.isArray(d.ingredients) ? d.ingredients : [],
        seasonings: Array.isArray(d.seasonings) ? d.seasonings : [],
        estimatedNutrition: d.estimatedNutrition ?? { ...ZERO_NUTRITION },
        // 已经是新结构就原样保留，否则留空等下面统一挂
        prepSteps: alreadyNested ? d.prepSteps : [],
        cookingSteps: alreadyNested ? d.cookingSteps : [],
      };
    });

  // 只有老结构才需要重新挂步骤（新结构的菜里已经带着）
  const needsAttach = raw.dishes.some(
    (d: any) => !(Array.isArray(d?.prepSteps) && Array.isArray(d?.cookingSteps)),
  );
  if (needsAttach && dishes.length > 0) {
    attachStepsToDishes(dishes, legacyPrep, legacyCooking);
  }

  const missingItems: ShoppingItem[] = Array.isArray(raw.missingItems) ? raw.missingItems : [];

  return {
    dishes,
    estimatedNutrition: raw.estimatedNutrition ?? sumNutrition(dishes),
    missingItems,
    cookingOrderDescription: raw.cookingOrderDescription ?? '',
    flavorDescription: raw.flavorDescription ?? '',
    summary: raw.summary ?? { description: '', cookingOrder: '', flavorNotes: '' },
  };
}

// ---------------------------------------------------------------------------
// 应用：纯本地，无网络
// ---------------------------------------------------------------------------

/**
 * 把编辑动作应用到菜单上，返回新的 MenuProposal。
 *
 * 步骤跟着菜走，所以这里不再有"删菜时顺手清掉它的步骤""营养按下标对齐"
 * 这类手工同步——这正是把菜品做成自包含模块的收益。
 */
export function applyEdits(
  menu: MenuProposal,
  requirement: RequirementInput,
  edits: MenuEdit[],
  opts: { inventoryNames?: string[] } = {},
): MenuProposal {
  let dishes: DishPlan[] = (menu.dishes ?? []).map(cloneDish);

  let scaleFactor = 1;
  const oldCount = requirement.personCount || 1;
  const inventoryNames = (opts.inventoryNames ?? []).map((n) => n.trim());
  const isInInventory = (name: string) => inventoryNames.includes(name.trim());

  for (const edit of edits) {
    switch (edit.op) {
      case 'set_grams': {
        const dish = findDish(dishes, edit.dish);
        if (!dish) break;
        const ing = dish.ingredients.find((i) => i.name.trim() === edit.ingredient.trim());
        if (!ing) break;
        const grams = Math.max(1, Math.round(edit.grams));
        ing.estimatedWeight = grams;
        // 步骤文案里的同一个食材也要跟着改，否则界面显示 3g、步骤写 2g
        dish.prepSteps = dish.prepSteps.map((s) => ({
          ...s,
          description: setGramsInText(s.description, ing.name, grams),
        }));
        dish.cookingSteps = dish.cookingSteps.map((s) => ({
          ...s,
          instruction: setGramsInText(s.instruction, ing.name, grams),
        }));
        break;
      }

      case 'add_ingredient': {
        const dish = findDish(dishes, edit.dish);
        if (!dish) break;
        const name = edit.ingredient.trim();
        if (!name || dish.ingredients.some((i) => i.name.trim() === name)) break;
        dish.ingredients.push({
          name,
          estimatedWeight: Math.max(1, Math.round(edit.grams)),
          isInInventory: isInInventory(name),
        });
        break;
      }

      case 'remove_ingredient': {
        const dish = findDish(dishes, edit.dish);
        if (!dish) break;
        const name = edit.ingredient.trim();
        const before = dish.ingredients.length;
        dish.ingredients = dish.ingredients.filter((i) => i.name.trim() !== name);
        if (dish.ingredients.length === before) break;
        dish.prepSteps = dish.prepSteps.map((s) => ({
          ...s,
          description: removeTagFromText(s.description, name),
        }));
        dish.cookingSteps = dish.cookingSteps.map((s) => ({
          ...s,
          instruction: removeTagFromText(s.instruction, name),
        }));
        break;
      }

      case 'set_seasoning_amount': {
        const dish = findDish(dishes, edit.dish);
        if (!dish) break;
        const seasoning = dish.seasonings.find((s) => s.name.trim() === edit.seasoning.trim());
        if (!seasoning) break;
        const next = edit.amount.trim();
        if (!next || next === seasoning.amount) break;
        seasoning.amount = next;
        // 步骤文案里出现这个调料时，标签里的克数也要跟着改，否则界面写 3g、步骤写 2g
        const grams = parseGramAmount(next);
        if (grams > 0) {
          dish.prepSteps = dish.prepSteps.map((s) => ({
            ...s,
            description: setGramsInText(s.description, seasoning.name, grams),
          }));
          dish.cookingSteps = dish.cookingSteps.map((s) => ({
            ...s,
            instruction: setGramsInText(s.instruction, seasoning.name, grams),
          }));
        }
        break;
      }

      case 'rename_dish': {
        const dish = findDish(dishes, edit.dish);
        const next = edit.newName.trim();
        if (!dish || !next) break;
        if (dishes.some((d) => d !== dish && d.name.trim() === next)) break;
        dish.name = next;
        break;
      }

      case 'remove_dish': {
        const dish = findDish(dishes, edit.dish);
        if (!dish) break;
        // 步骤就在这道菜里，一起走
        dishes = dishes.filter((d) => d !== dish);
        break;
      }

      case 'set_person_count': {
        const next = Math.max(1, Math.round(edit.personCount));
        if (next === oldCount) break;
        scaleFactor = next / oldCount;
        break;
      }

      case 'replace_dish': {
        const idx = dishes.findIndex((d) => d.name.trim() === edit.dish.trim());
        if (idx < 0) break;
        dishes[idx] = cloneDish(edit.generated);
        break;
      }

      case 'add_dish': {
        dishes.push(cloneDish(edit.generated));
        break;
      }
    }
  }

  // ---- 人数缩放：菜品用量、步骤文案一起动 ----
  if (scaleFactor !== 1) {
    dishes = dishes.map((d) => ({
      ...d,
      ingredients: d.ingredients.map((i) => ({
        ...i,
        estimatedWeight: Math.max(1, Math.round(i.estimatedWeight * scaleFactor)),
      })),
      seasonings: d.seasonings.map((s) => ({
        ...s,
        amount: scaleGramAmount(s.amount, scaleFactor),
      })),
      estimatedNutrition: scaleNutrition(d.estimatedNutrition, scaleFactor),
      prepSteps: d.prepSteps.map((s) => ({
        ...s,
        description: scaleGramsInText(s.description, scaleFactor),
        quantity: scaleGramAmount(s.quantity, scaleFactor),
      })),
      cookingSteps: d.cookingSteps.map((s) => ({
        ...s,
        instruction: scaleGramsInText(s.instruction, scaleFactor),
      })),
    }));
  }

  // ---- 按最终克数重算每道菜的热量 ----
  // 放在缩放之后：此时克数已经是最终值，算出来的热量自然对得上。
  dishes = dishes.map(recomputeNutrition);

  // ---- 重算派生字段 ----
  const purchasedKeys = new Set(
    (menu.missingItems ?? []).filter((m) => m.isPurchased).map((m) => `${m.type}|${m.name.trim()}`),
  );
  const missingItems: ShoppingItem[] = [];
  const seen = new Set<string>();

  for (const dish of dishes) {
    for (const ing of dish.ingredients) {
      if (ing.isInInventory) continue;
      const key = `ingredient|${ing.name.trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      missingItems.push({
        id: key,
        type: 'ingredient',
        name: ing.name.trim(),
        suggestedAmount: `${ing.estimatedWeight}g`,
        forDish: dish.name,
        isPurchased: purchasedKeys.has(key),
      });
    }
    for (const s of dish.seasonings) {
      if (s.isInInventory) continue;
      const key = `seasoning|${s.name.trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      missingItems.push({
        id: key,
        type: 'seasoning',
        name: s.name.trim(),
        suggestedAmount: s.amount,
        forDish: dish.name,
        isPurchased: purchasedKeys.has(key),
      });
    }
  }

  // 已购入状态按「类型|名字」保留；其余以 dishes 的 isInInventory 为准重建，
  // 这样加减菜之后采购清单不会残留已经不用的食材。
  return {
    ...menu,
    dishes,
    estimatedNutrition: sumNutrition(dishes),
    missingItems,
  };
}


