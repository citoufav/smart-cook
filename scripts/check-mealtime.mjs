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

// 9. 「放得有点久」的判定：本地按入库日期算，不问 AI
import { shelfLifeDays, findAgingIngredients } from '../src/utils/shelfLife.ts';

const NOW = new Date(2026, 10, 1, 12, 0, 0);
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

assert.equal(shelfLifeDays('猪肉'), 3, '生鲜肉只有 3 天');
assert.equal(shelfLifeDays('虾仁'), 2, '水产最短');
assert.equal(shelfLifeDays('菠菜'), 3, '叶菜短');
assert.equal(shelfLifeDays('土豆'), 21, '根茎长');
assert.equal(shelfLifeDays('大米'), 30);
assert.equal(shelfLifeDays('神秘食材'), 7, '没见过的按保守默认值');

// 猪肉存 5 天要提醒；存 3 天（刚好到期）先不吓人
let aging = findAgingIngredients(
  [{ name: '猪肉', createDate: daysAgo(5) }, { name: '猪肉', createDate: daysAgo(3) }],
  NOW,
);
assert.equal(aging.length, 1, '只提醒超过保质期的那一份');

// 超过得越多排越前
aging = findAgingIngredients(
  [
    { name: '土豆', createDate: daysAgo(22) },   // 超 1 天
    { name: '虾仁', createDate: daysAgo(9) },    // 超 7 天
    { name: '猪肉', createDate: daysAgo(6) },    // 超 3 天
  ],
  NOW,
);
assert.deepEqual(aging.map((a) => a.name), ['虾仁', '猪肉', '土豆'], '排序不是按"超出多少天"');

// 坏日期、空名字不能把人搞崩
assert.deepEqual(findAgingIngredients([{ name: '', createDate: daysAgo(99) }], NOW), []);
assert.deepEqual(findAgingIngredients([{ name: '猪肉', createDate: 'not-a-date' }], NOW), []);
assert.deepEqual(findAgingIngredients([], NOW), []);

// 存放方式：常温更短、冷冻更久，没设按冷藏算
assert.equal(shelfLifeDays('猪肉', 'room'), 2, '常温比冷藏还短');
assert.equal(shelfLifeDays('猪肉', 'fridge'), 3);
assert.equal(shelfLifeDays('猪肉', 'freezer'), 45, '冷冻按 15 倍放宽');
assert.equal(shelfLifeDays('猪肉', undefined), 3, '没设存放方式按冷藏');
assert.equal(shelfLifeDays('鸡蛋', 'room'), 8, '14 天 × 0.6');

// 同一份食材换个存放方式，提醒结论要跟着变
assert.equal(findAgingIngredients([{ name: '猪肉', createDate: daysAgo(5), storage: 'freezer' }], NOW).length, 0);
assert.equal(findAgingIngredients([{ name: '猪肉', createDate: daysAgo(5), storage: 'fridge' }], NOW).length, 1);
// 常温 2 天上限：存 2 天不提醒，存 3 天才提醒
assert.equal(findAgingIngredients([{ name: '猪肉', createDate: daysAgo(2), storage: 'room' }], NOW).length, 0);
assert.equal(findAgingIngredients([{ name: '猪肉', createDate: daysAgo(3), storage: 'room' }], NOW).length, 1);

console.log('✓ 下一顿推算与食材保质期 11 组全部通过');
