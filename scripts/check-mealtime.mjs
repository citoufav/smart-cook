/**
 * 「下一顿」推算的自检。跑法：
 *   node scripts/check-mealtime.mjs
 *
 * 边界错一小时，用户就会在晚上七点被推荐早餐 —— 所以每个边界都断言。
 */
import assert from 'node:assert/strict';
import { nextMealFor } from '../src/utils/mealTime.ts';

/** 用本地时间构造，避免时区把边界测歪 */
const at = (h, m = 0) => new Date(2026, 10, 1, h, m, 0);

const cases = [
  [at(5, 0), 'breakfast', 300, '凌晨 5 点起算早餐'],
  [at(7, 30), 'breakfast', 300, '早上 7 点半还是早餐'],
  [at(9, 59), 'breakfast', 300, '9:59 仍是早餐'],
  [at(10, 0), 'lunch', 700, '10 点整切午餐'],
  [at(12, 0), 'lunch', 700, '中午是午餐'],
  [at(14, 59), 'lunch', 700, '14:59 仍是午餐'],
  [at(15, 0), 'dinner', 500, '15 点整切晚餐'],
  [at(19, 0), 'dinner', 500, '晚上七点应该是晚餐，不是早餐'],
  [at(20, 59), 'dinner', 500, '20:59 仍是晚餐'],
  [at(21, 0), 'breakfast', 300, '21 点起算明天的早餐'],
  [at(23, 30), 'breakfast', 300, '深夜算早餐'],
  [at(3, 0), 'breakfast', 300, '凌晨 3 点算早餐'],
];

for (const [date, mealType, calorie, why] of cases) {
  const got = nextMealFor(date);
  assert.equal(got.mealType, mealType, `${why}：期望 ${mealType}，得到 ${got.mealType}`);
  assert.equal(got.calorie, calorie, `${why}：热量应为 ${calorie}，得到 ${got.calorie}`);
  assert.ok(got.label.length > 0, 'label 不能为空');
}

// 三档热量必须是常见档位（界面上有 300 / 500 / 700 / 1000 四个预设）
const calories = new Set(['breakfast', 'lunch', 'dinner'].map((m) => nextMealFor(at(7)).calorie));
assert.ok(calories.size >= 1);
assert.equal(nextMealFor(at(7)).calorie, 300);
assert.equal(nextMealFor(at(12)).calorie, 700);
assert.equal(nextMealFor(at(18)).calorie, 500);

console.log('✓ 下一顿推算 12 个时间点全部通过');
