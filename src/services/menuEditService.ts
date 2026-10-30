import type {
  MenuProposal,
  DishPlan,
  PrepStep,
  CookingStep,
  RequirementInput,
  NutritionInfo,
  ShoppingItem,
} from '../types';

/**
 * AI 可以下发的**最小编辑动作**。
 *
 * 设计要点：这些都是"局部改动"，客户端可以确定性执行，不需要再调一次模型
 * 把整份菜单重新生成一遍。只有 replace_dish / add_dish 需要 AI 生成新菜，
 * 而那个生成只产出一道菜（几百 token），不会撞输出上限。
 */
export type MenuEdit =
  | { op: 'set_grams'; dish: string; ingredient: string; grams: number }
  | { op: 'add_ingredient'; dish: string; ingredient: string; grams: number }
  | { op: 'remove_ingredient'; dish: string; ingredient: string }
  | { op: 'remove_dish'; dish: string }
  | { op: 'set_person_count'; personCount: number }
  | { op: 'replace_dish'; dish: string; instruction: string }
  | { op: 'add_dish'; instruction: string };

/** 需要生成新菜时，AI 的产物回填在这里，之后 applyEdits 才能纯本地执行 */
export interface GeneratedDish {
  dish: DishPlan;
  prepSteps: PrepStep[];
  cookingSteps: CookingStep[];
}

export type ResolvedMenuEdit = MenuEdit & { generated?: GeneratedDish };

export interface EditDiffLine {
  /** 在 edits 数组里的下标，用于逐项勾选 */
  index: number;
  dish: string;
  kind: 'change' | 'add' | 'remove';
  text: string;
}

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

function scaleNutrition(n: NutritionInfo | undefined, factor: number): NutritionInfo {
  if (!n) return { calories: 0, protein: 0, fat: 0, carbs: 0 };
  return {
    calories: Math.round(n.calories * factor),
    protein: Math.round(n.protein * factor),
    fat: Math.round(n.fat * factor),
    carbs: Math.round(n.carbs * factor),
  };
}

function cloneDish(d: DishPlan): DishPlan {
  return {
    ...d,
    ingredients: (d.ingredients ?? []).map((i) => ({ ...i })),
    seasonings: (d.seasonings ?? []).map((s) => ({ ...s })),
    estimatedNutrition: { ...d.estimatedNutrition },
  };
}

function findDishIndex(dishes: DishPlan[], name: string): number {
  const target = name.trim();
  return dishes.findIndex((d) => d.name.trim() === target);
}

// ---------------------------------------------------------------------------
// 预览：把动作翻译成人能读的差异行
// ---------------------------------------------------------------------------

/**
 * 这条动作在当前菜谱上是否真的能生效。
 * 模型偶尔会写出对不上的菜名/食材名，预览里显示"（未找到）"再让用户确认很误导，
 * 所以在开预览之前先过滤一遍。
 */
export function isApplicableEdit(menu: MenuProposal, edit: MenuEdit): boolean {
  const dishes = menu.dishes ?? [];
  switch (edit.op) {
    case 'set_person_count':
      return true;
    case 'add_dish':
      return true;
    case 'remove_dish':
    case 'replace_dish':
      return findDishIndex(dishes, edit.dish) >= 0;
    case 'set_grams':
    case 'remove_ingredient': {
      const idx = findDishIndex(dishes, edit.dish);
      if (idx < 0) return false;
      return dishes[idx].ingredients.some((i) => i.name.trim() === edit.ingredient.trim());
    }
    case 'add_ingredient': {
      const idx = findDishIndex(dishes, edit.dish);
      if (idx < 0) return false;
      return !dishes[idx].ingredients.some((i) => i.name.trim() === edit.ingredient.trim());
    }
    default:
      return false;
  }
}

export function diffEdits(menu: MenuProposal, edits: ResolvedMenuEdit[]): EditDiffLine[] {
  const lines: EditDiffLine[] = [];
  const dishes = menu.dishes ?? [];

  edits.forEach((edit, index) => {
    switch (edit.op) {
      case 'set_grams': {
        const dish = dishes[findDishIndex(dishes, edit.dish)];
        const ing = dish?.ingredients?.find((i) => i.name.trim() === edit.ingredient.trim());
        const from = ing ? `${ing.estimatedWeight}g` : '（未找到）';
        lines.push({
          index,
          dish: edit.dish,
          kind: 'change',
          text: `${edit.ingredient}  ${from} → ${edit.grams}g`,
        });
        break;
      }
      case 'add_ingredient':
        lines.push({
          index,
          dish: edit.dish,
          kind: 'add',
          text: `加入 ${edit.ingredient} ${edit.grams}g`,
        });
        break;
      case 'remove_ingredient':
        lines.push({
          index,
          dish: edit.dish,
          kind: 'remove',
          text: `去掉 ${edit.ingredient}`,
        });
        break;
      case 'remove_dish':
        lines.push({ index, dish: edit.dish, kind: 'remove', text: `移除整道菜` });
        break;
      case 'set_person_count':
        lines.push({
          index,
          dish: '用餐人数',
          kind: 'change',
          text: `人数改为 ${edit.personCount} 人，所有用量按比例缩放`,
        });
        break;
      case 'replace_dish':
        lines.push({
          index,
          dish: edit.dish,
          kind: 'change',
          text: edit.generated ? `换成「${edit.generated.dish.name}」` : `整道菜重新生成`,
        });
        break;
      case 'add_dish':
        lines.push({
          index,
          dish: '新增',
          kind: 'add',
          text: edit.generated ? `加一道「${edit.generated.dish.name}」` : `新增一道菜`,
        });
        break;
    }
  });

  return lines;
}

// ---------------------------------------------------------------------------
// 应用：纯本地，无网络
// ---------------------------------------------------------------------------

/**
 * 把编辑动作应用到菜单上，返回新的 MenuProposal。
 *
 * 派生字段统一在这里重算，避免"改了菜但营养/缺料没跟上"：
 * - estimatedNutrition = 各菜之和
 * - missingItems 由 dishes 里的 isInInventory 重建，isPurchased 按名字保留
 * - preciseNutrition 对齐 dishes 长度
 * - prepSteps.order / cookingSteps.stepNumber 重新编号
 */
export function applyEdits(
  menu: MenuProposal,
  requirement: RequirementInput,
  edits: ResolvedMenuEdit[],
  opts: { inventoryNames?: string[] } = {},
): MenuProposal {
  let dishes: DishPlan[] = (menu.dishes ?? []).map(cloneDish);
  let prepSteps: PrepStep[] = (menu.prepSteps ?? []).map((s) => ({ ...s }));
  let cookingSteps: CookingStep[] = (menu.cookingSteps ?? []).map((s) => ({ ...s }));
  let preciseNutrition: NutritionInfo[] = (menu.preciseNutrition ?? []).map((n) => ({ ...n }));

  let scaleFactor = 1;
  const oldCount = requirement.personCount || 1;
  const inventoryNames = (opts.inventoryNames ?? []).map((n) => n.trim());
  const isInInventory = (name: string) => inventoryNames.includes(name.trim());

  const dropStepsOfDish = (name: string) => {
    prepSteps = prepSteps.filter((s) => s.dishName !== name);
    cookingSteps = cookingSteps.filter((s) => s.dishName !== name);
  };

  for (const edit of edits) {
    switch (edit.op) {
      case 'set_grams': {
        const idx = findDishIndex(dishes, edit.dish);
        if (idx < 0) break;
        const dish = dishes[idx];
        const grams = Math.max(1, Math.round(edit.grams));
        const ing = dish.ingredients.find((i) => i.name.trim() === edit.ingredient.trim());
        if (!ing) break;
        ing.estimatedWeight = grams;
        // 步骤文案里的同一个食材也要跟着改，否则界面显示 3g、步骤写 2g
        for (const s of prepSteps) {
          if (s.dishName === dish.name) s.description = setGramsInText(s.description, ing.name, grams);
        }
        for (const s of cookingSteps) {
          if (s.dishName === dish.name) s.instruction = setGramsInText(s.instruction, ing.name, grams);
        }
        break;
      }

      case 'add_ingredient': {
        const idx = findDishIndex(dishes, edit.dish);
        if (idx < 0) break;
        const dish = dishes[idx];
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
        const idx = findDishIndex(dishes, edit.dish);
        if (idx < 0) break;
        const dish = dishes[idx];
        const name = edit.ingredient.trim();
        const before = dish.ingredients.length;
        dish.ingredients = dish.ingredients.filter((i) => i.name.trim() !== name);
        if (dish.ingredients.length === before) break;
        for (const s of prepSteps) {
          if (s.dishName === dish.name) s.description = removeTagFromText(s.description, name);
        }
        for (const s of cookingSteps) {
          if (s.dishName === dish.name) s.instruction = removeTagFromText(s.instruction, name);
        }
        break;
      }

      case 'remove_dish': {
        const idx = findDishIndex(dishes, edit.dish);
        if (idx < 0) break;
        const name = dishes[idx].name;
        dishes = dishes.filter((_, i) => i !== idx);
        preciseNutrition = preciseNutrition.filter((_, i) => i !== idx);
        dropStepsOfDish(name);
        break;
      }

      case 'set_person_count': {
        const next = Math.max(1, Math.round(edit.personCount));
        if (next === oldCount) break;
        scaleFactor = next / oldCount;
        break;
      }

      case 'replace_dish': {
        const idx = findDishIndex(dishes, edit.dish);
        if (idx < 0) break;
        const name = dishes[idx].name;
        dropStepsOfDish(name);
        if (!edit.generated) break;
        dishes[idx] = cloneDish(edit.generated.dish);
        preciseNutrition[idx] = { ...edit.generated.dish.estimatedNutrition };
        prepSteps.push(...edit.generated.prepSteps.map((s) => ({ ...s, dishName: edit.generated!.dish.name })));
        cookingSteps.push(...edit.generated.cookingSteps.map((s) => ({ ...s, dishName: edit.generated!.dish.name })));
        break;
      }

      case 'add_dish': {
        if (!edit.generated) break;
        dishes.push(cloneDish(edit.generated.dish));
        preciseNutrition.push({ ...edit.generated.dish.estimatedNutrition });
        prepSteps.push(...edit.generated.prepSteps.map((s) => ({ ...s, dishName: edit.generated!.dish.name })));
        cookingSteps.push(...edit.generated.cookingSteps.map((s) => ({ ...s, dishName: edit.generated!.dish.name })));
        break;
      }
    }
  }

  // ---- 人数缩放：菜品用量、步骤文案、营养一起动 ----
  if (scaleFactor !== 1) {
    dishes = dishes.map((d) => ({
      ...d,
      ingredients: d.ingredients.map((i) => ({
        ...i,
        estimatedWeight: Math.max(1, Math.round(i.estimatedWeight * scaleFactor)),
      })),
      estimatedNutrition: scaleNutrition(d.estimatedNutrition, scaleFactor),
    }));
    preciseNutrition = preciseNutrition.map((n) => scaleNutrition(n, scaleFactor));
    prepSteps = prepSteps.map((s) => ({
      ...s,
      description: scaleGramsInText(s.description, scaleFactor),
      quantity: scaleQuantity(s.quantity, scaleFactor),
    }));
    cookingSteps = cookingSteps.map((s) => ({
      ...s,
      instruction: scaleGramsInText(s.instruction, scaleFactor),
    }));
  }

  // ---- 重算派生字段 ----
  const totalNutrition = dishes.reduce<NutritionInfo>(
    (sum, d) => ({
      calories: sum.calories + (d.estimatedNutrition?.calories || 0),
      protein: sum.protein + (d.estimatedNutrition?.protein || 0),
      fat: sum.fat + (d.estimatedNutrition?.fat || 0),
      carbs: sum.carbs + (d.estimatedNutrition?.carbs || 0),
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  );

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
    prepSteps: renumberPrep(prepSteps),
    cookingSteps: renumberCooking(cookingSteps),
    preciseNutrition,
    estimatedNutrition: totalNutrition,
    missingItems,
  };
}

/** prepSteps.quantity 形如 "200g"，按比例缩放 */
function scaleQuantity(quantity: string, factor: number): string {
  const m = /^(\d+(?:\.\d+)?)\s*(g|克)?$/.exec((quantity || '').trim());
  if (!m) return quantity;
  const scaled = Math.max(1, Math.round(parseFloat(m[1]) * factor));
  return `${scaled}${m[2] || 'g'}`;
}

function renumberPrep(steps: PrepStep[]): PrepStep[] {
  return steps.map((s, i) => ({ ...s, order: i + 1, id: s.id || `prep-${i + 1}` }));
}

function renumberCooking(steps: CookingStep[]): CookingStep[] {
  return steps.map((s, i) => ({ ...s, stepNumber: i + 1 }));
}
