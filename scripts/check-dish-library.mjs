/**
 * 菜品库合并规则的自检。跑法：
 *   node scripts/check-dish-library.mjs
 *
 * 重点盯：同一道菜反复做要累加次数、同一份菜单里同名只算一次、
 * 内容永远是最新那版、以及「米饭」这类主食根本不进库。
 */
import assert from 'node:assert/strict';
import {
  normalizeDishName,
  mergeDishIntoLibrary,
  isStapleDish,
  DISH_LIBRARY_LIMIT,
} from '../src/utils/dishLibrary.ts';

function dish(name, extra = {}) {
  return {
    id: `gen-${Math.random()}`,
    name,
    ingredients: [{ name: '食材', estimatedWeight: 100, isInInventory: true }],
    seasonings: [],
    estimatedNutrition: { calories: 200, protein: 10, fat: 5, carbs: 20 },
    prepSteps: [],
    cookingSteps: [],
    ...extra,
  };
}

const T1 = '2026-11-01T10:00:00.000Z';
const T2 = '2026-11-02T10:00:00.000Z';
const T3 = '2026-11-03T10:00:00.000Z';

// 1. 归一化：只处理"同一道菜的不同写法"，不做模糊匹配
assert.equal(normalizeDishName('  青椒肉丝 '), '青椒肉丝');
assert.equal(normalizeDishName('青椒肉丝\u3000'), '青椒肉丝');
assert.equal(normalizeDishName('番茄  炒蛋'), '番茄 炒蛋');
assert.equal(normalizeDishName('麻婆豆腐（不辣版）'), '麻婆豆腐(不辣版)');
assert.notEqual(
  normalizeDishName('麻婆豆腐'),
  normalizeDishName('麻婆豆腐（不辣版）'),
  '带括号说明的是另一道菜，不能合并',
);

// 2. 第一次入库：次数 1、创建时间 = 最近做的时间、记下基准人数
let lib = mergeDishIntoLibrary([], [dish('青椒肉丝')], 2, T1);
assert.equal(lib.length, 1);
assert.equal(lib[0].id, '青椒肉丝');
assert.equal(lib[0].timesCooked, 1);
assert.equal(lib[0].createdAt, T1);
assert.equal(lib[0].lastCookedAt, T1);
assert.equal(lib[0].basePersonCount, 2, '没记下基准人数就没法按新人数复用');

// 3. 同一道菜再做一次：还是那一条，次数累加，创建时间不变，内容换成最近这版
lib = mergeDishIntoLibrary(
  lib,
  [dish('青椒肉丝', { estimatedNutrition: { calories: 260, protein: 6, fat: 0, carbs: 59 } })],
  4,
  T2,
);
assert.equal(lib.length, 1, '同一道菜不该变成两条');
assert.equal(lib[0].timesCooked, 2);
assert.equal(lib[0].createdAt, T1, '创建时间被覆盖了');
assert.equal(lib[0].lastCookedAt, T2);
assert.equal(lib[0].estimatedNutrition.calories, 260, '内容不是最近这一版');
assert.equal(lib[0].basePersonCount, 4, '基准人数没跟着更新');
assert.equal(lib[0].ingredients[0].estimatedWeight, 100);

// 4. 同一份菜单里出现两道同名菜：只算做过一次
lib = mergeDishIntoLibrary([], [dish('青椒肉丝'), dish('青椒肉丝'), dish('番茄炒蛋')], 2, T1);
assert.equal(lib.length, 2, '同一份菜单里的同名菜被算成了两道');
assert.equal(lib.find((d) => d.id === '青椒肉丝').timesCooked, 1, '一次做饭把次数刷成了 2');

// 5. 排序：最近做过的排前面
lib = mergeDishIntoLibrary(
  [{ id: '旧菜', name: '旧菜', ingredients: [], seasonings: [], estimatedNutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 }, prepSteps: [], cookingSteps: [], basePersonCount: 1, timesCooked: 1, lastCookedAt: T1, createdAt: T1 }],
  [dish('新菜')],
  1,
  T3,
);
assert.equal(lib[0].id, '新菜');
assert.equal(lib[1].id, '旧菜');

// 6. 空名字跳过，不会在库里留一条 id 为空的幽灵菜
lib = mergeDishIntoLibrary([], [dish(''), dish('   '), dish('青椒肉丝')], 1, T1);
assert.equal(lib.length, 1);

// 7. 容量上限：超出时淘汰最久没做的
const base = Date.parse('2026-01-01T00:00:00.000Z');
const full = Array.from({ length: DISH_LIBRARY_LIMIT }, (_, i) => ({
  id: `菜${i}`,
  name: `菜${i}`,
  ingredients: [],
  seasonings: [],
  estimatedNutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
  prepSteps: [],
  cookingSteps: [],
  basePersonCount: 1,
  timesCooked: 1,
  // 严格递增，保证「最久没做」只有一条，测试才有确定的期望
  lastCookedAt: new Date(base + i * 60_000).toISOString(),
  createdAt: T1,
}));
lib = mergeDishIntoLibrary(full, [dish('新做的菜')], 1, T3);
assert.equal(lib.length, DISH_LIBRARY_LIMIT, '超出上限没有裁剪');
assert.equal(lib[0].id, '新做的菜');
assert.ok(!lib.some((d) => d.id === '菜0'), '最久没做的那道没有被淘汰');

// 8. 主食不算一道菜：不进库，「最近吃过」也靠这个判定滤掉
for (const name of ['米饭', '白米饭', '一碗米饭', '糙米饭', '杂粮饭', '馒头', '花卷', '面条', '稀饭', '米饭（小碗）']) {
  assert.ok(isStapleDish(name), `主食没认出来：${name}`);
}
for (const name of ['蛋炒饭', '扬州炒饭', '小葱鸡蛋汤面', '青椒肉丝', '南瓜饭', '番茄牛腩面']) {
  assert.ok(!isStapleDish(name), `把正经菜误判成主食了：${name}`);
}
lib = mergeDishIntoLibrary([], [dish('米饭'), dish('白米饭'), dish('馒头'), dish('青椒肉丝')], 2, T1);
assert.equal(lib.length, 1, '主食进了菜品库');
assert.equal(lib[0].id, '青椒肉丝');
// 老数据里已经存了米饭：下一次写入顺手清掉，不用单独做迁移
const legacy = [{ id: '米饭', name: '米饭', ingredients: [], seasonings: [], estimatedNutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 }, prepSteps: [], cookingSteps: [], basePersonCount: 1, timesCooked: 9, lastCookedAt: T1, createdAt: T1 }];
lib = mergeDishIntoLibrary(legacy, [dish('青椒肉丝')], 2, T2);
assert.equal(lib.length, 1, '老数据里的米饭没被清掉');
assert.equal(lib[0].id, '青椒肉丝');

console.log('✓ 菜品库合并规则 8 组全部通过');
