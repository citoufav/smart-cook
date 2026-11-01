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

  return [...byId.values()]
    .sort((a, b) => (a.lastCookedAt < b.lastCookedAt ? 1 : a.lastCookedAt > b.lastCookedAt ? -1 : 0))
    .slice(0, DISH_LIBRARY_LIMIT);
}
