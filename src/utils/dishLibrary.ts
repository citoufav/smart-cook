import type { SavedDish, DishPlan } from '../types';

/** 库的容量上限。超出时按「最久没做」淘汰 —— 那才是最可能永远用不上的那些 */
export const DISH_LIBRARY_LIMIT = 200;

/**
 * 菜品身份 = 归一化后的菜名。
 *
 * 只处理"同一道菜的不同写法"：首尾空白、中间多余空白、全角空格、全角括号。
 * **刻意不做模糊匹配**：「麻婆豆腐」和「麻婆豆腐（不辣版）」是两道不同的菜，
 * 合并掉反而是错的。同理也不去掉括号里的说明。
 */
export function normalizeDishName(name: string): string {
  return name
    .replace(/[\u3000\s]+/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .trim();
}

/**
 * 主食不算「一道菜」。
 *
 * 模型被规则 6 要求把米饭/馒头也写进 dishes（菜单里确实需要它来凑热量、写蒸饭步骤），
 * 但米饭不是"下次还想再做一遍"的菜 —— 它进菜品库和「最近吃过」只会碍眼。
 *
 * 判定用名字白名单：精确匹配，去掉尾部括号说明和开头量词。
 * ponytail: 名字匹配，认不出的写法（「一碗杂粮饭」「东北大米饭」）会照常入库；
 * 要精确得让模型在输出里带 category 字段，现在不值得。
 */
const STAPLE_NAMES = new Set([
  '米饭', '白饭', '白米饭', '大米饭', '糙米饭', '杂粮饭', '二米饭', '小米饭', '紫米饭', '玉米饭',
  '馒头', '花卷', '烙饼',
  '面条', '白粥', '小米粥', '稀饭', '粥',
]);

export function isStapleDish(name: string): boolean {
  const base = normalizeDishName(name ?? '')
    .replace(/\s*[（(][^）)]*[）)]\s*$/, '')
    .replace(/^[一两二三四五1-5]碗/, '');
  return STAPLE_NAMES.has(base);
}

function cloneDishInto(saved: SavedDish, dish: DishPlan, personCount: number, now: string): SavedDish {
  return {
    ...saved,
    name: dish.name.trim(),
    ingredients: dish.ingredients.map((i) => ({ ...i })),
    seasonings: dish.seasonings.map((s) => ({ ...s })),
    estimatedNutrition: { ...dish.estimatedNutrition },
    prepSteps: dish.prepSteps.map((s) => ({ ...s })),
    cookingSteps: dish.cookingSteps.map((s) => ({ ...s })),
    basePersonCount: Math.max(1, Math.round(personCount)),
    lastCookedAt: now,
  };
}

/**
 * 把一份菜单里的菜并进菜品库。
 *
 * - 同名（归一化后）视为同一道菜：内容覆盖成最近这一版，`timesCooked` +1，`createdAt` 保留
 * - 同一份菜单里出现两道同名菜只算做过一次（否则一次做饭会把计数刷成 2）
 * - 返回按「最近做过」排序、长度不超过上限的新列表
 */
export function mergeDishIntoLibrary(
  existing: SavedDish[],
  dishes: DishPlan[],
  personCount: number,
  now: string,
): SavedDish[] {
  const byId = new Map(existing.map((d) => [d.id, d]));
  const handledThisTime = new Set<string>();

  for (const dish of dishes) {
    const id = normalizeDishName(dish.name ?? '');
    if (!id || handledThisTime.has(id)) continue;
    if (isStapleDish(id)) continue;
    handledThisTime.add(id);

    const prev = byId.get(id);
    const base: SavedDish =
      prev ??
      ({
        id,
        name: dish.name.trim(),
        ingredients: [],
        seasonings: [],
        estimatedNutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
        prepSteps: [],
        cookingSteps: [],
        basePersonCount: 1,
        timesCooked: 0,
        lastCookedAt: now,
        createdAt: now,
      } satisfies SavedDish);

    byId.set(id, {
      ...cloneDishInto(base, dish, personCount, now),
      timesCooked: base.timesCooked + 1,
    });
  }

  // 顺手把老数据里的主食清掉：写一次就自愈，不用单独做迁移
  return [...byId.values()]
    .filter((d) => !isStapleDish(d.name))
    .sort((a, b) => (a.lastCookedAt < b.lastCookedAt ? 1 : a.lastCookedAt > b.lastCookedAt ? -1 : 0))
    .slice(0, DISH_LIBRARY_LIMIT);
}
