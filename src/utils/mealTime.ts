/**
 * 「下一顿吃什么」的时间和热量对应表。
 *
 * 纯函数，能直接跑自检（npm run check:meal）—— 这里错一小时，用户就可能在
 * 晚上 7 点被推荐早餐。
 *
 * 边界说明：判断的是**接下来要做的那一顿**，不是"现在几点所以算哪一顿"。
 * 所以 21:00 之后到凌晨 5 点之间算「明天的早餐」。
 * 这也意味着 15:00 之后不会给"早餐"：17 点生成一份早餐对谁都没意义。
 */
export type MealType = 'breakfast' | 'lunch' | 'dinner';

export interface NextMeal {
  mealType: MealType;
  /** 每人多少大卡 */
  calorie: number;
  /** 中文名，直接用在按钮和说明里 */
  label: string;
}

const MEALS: Record<MealType, { calorie: number; label: string }> = {
  breakfast: { calorie: 300, label: '早餐' },
  lunch: { calorie: 700, label: '午餐' },
  dinner: { calorie: 500, label: '晚餐' },
};

export function nextMealFor(now: Date): NextMeal {
  const hour = now.getHours();
  let mealType: MealType;
  if (hour >= 5 && hour < 10) mealType = 'breakfast';
  else if (hour >= 10 && hour < 15) mealType = 'lunch';
  else if (hour >= 15 && hour < 21) mealType = 'dinner';
  // 21 点到次日 5 点：该准备的是明天的早饭
  else mealType = 'breakfast';

  return { mealType, ...MEALS[mealType] };
}
