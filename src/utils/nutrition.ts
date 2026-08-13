import { NutritionInfo, NutritionalData } from '../types';
import { logger } from './logger';

const log = logger('UTIL:NUTRITION');

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
  log.info('calculateTotalNutrition 开始', { dishCount: values.length });
  values.forEach((d, i) => {
    log.debug(`菜${i + 1} 营养信息`, { calories: d.calories, protein: d.protein, fat: d.fat, carbs: d.carbs });
  });
  const result = sumNutrition(values);
  log.info('calculateTotalNutrition 完成', { calories: result.calories, protein: result.protein, fat: result.fat, carbs: result.carbs });
  return result;
}

export function getDailyPercent(value: number, dailyValue: number): number {
  if (dailyValue <= 0) return 0;
  return Math.round((value / dailyValue) * 100);
}

/** Split total nutrition evenly per person */
export function getPerPersonNutrition(
  total: NutritionInfo,
  personCount: number,
): NutritionInfo {
  log.debug('getPerPersonNutrition', { personCount, total });
  if (personCount <= 0) {
    log.debug('getPerPersonNutrition: personCount<=0，返回原始total');
    return total;
  }
  const result = {
    calories: Math.round(total.calories / personCount),
    protein: Math.round(total.protein / personCount),
    fat: Math.round(total.fat / personCount),
    carbs: Math.round(total.carbs / personCount),
  };
  log.debug('getPerPersonNutrition 结果', { personCount, result });
  return result;
}
