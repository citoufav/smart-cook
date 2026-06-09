import { NutritionInfo, NutritionalData } from '../types';

export function sumNutrition(dataList: NutritionalData[]): NutritionInfo {
  return dataList.reduce(
    (acc, d) => ({
      calories: acc.calories + d.calories,
      protein: acc.protein + d.protein,
      fat: acc.fat + d.fat,
      carbs: acc.carbs + d.carbs,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

export function calculateTotalNutrition(
  nutritionByDish: Record<string, NutritionalData>,
): NutritionInfo {
  const values = Object.values(nutritionByDish);
  console.log('[NUTRITION:CALC] calculateTotalNutrition 入参 | 菜品数:', values.length);
  values.forEach((d, i) => {
    console.log(`[NUTRITION:CALC]   菜${i + 1}: calories=${d.calories}, protein=${d.protein}, fat=${d.fat}, carbs=${d.carbs}`);
  });
  const result = sumNutrition(values);
  console.log('[NUTRITION:CALC] 求和结果:', JSON.stringify(result));
  return result;
}

export function getDailyPercent(value: number, dailyValue: number): number {
  if (dailyValue <= 0) return 0;
  return Math.round((value / dailyValue) * 100);
}

/** 按人数平摊总营养 */
export function getPerPersonNutrition(
  total: NutritionInfo,
  personCount: number,
): NutritionInfo {
  console.log('[NUTRITION:PER] getPerPersonNutrition | total:', JSON.stringify(total), '| personCount:', personCount);
  if (personCount <= 0) {
    console.log('[NUTRITION:PER] → personCount<=0，返回原始total');
    return total;
  }
  const result = {
    calories: Math.round(total.calories / personCount),
    protein: Math.round(total.protein / personCount),
    fat: Math.round(total.fat / personCount),
    carbs: Math.round(total.carbs / personCount),
  };
  console.log('[NUTRITION:PER] 人均结果:', JSON.stringify(result));
  return result;
}
