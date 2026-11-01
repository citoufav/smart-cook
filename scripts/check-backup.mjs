/**
 * 备份格式与导入合并规则的自检。跑法：
 *   node scripts/check-backup.mjs
 *
 * 重点盯三件事：
 * 1. 文件来的对象是白名单重建的，不是 {...展开} —— 顺带确认原型没被污染
 * 2. 导入永远只增不改（同名跳过、同 id 跳过）
 * 3. 坏文件被挡住，而不是把现有数据搅烂
 */
import assert from 'node:assert/strict';
import {
  parseBackupJson,
  mergeInventory,
  mergeDishes,
  mergeRecords,
  mergeDietMemory,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  MAX_BACKUP_CHARS,
} from '../src/utils/backupFormat.ts';

const NOW = '2026-11-01T12:00:00.000Z';
let n = 0;
const nextId = () => `id-${++n}`;

// 1. 正常的 v2 文件：字段被重建，多余字段丢掉
const good = {
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: NOW,
  inventory: {
    currentProfileId: 'home',
    profiles: [
      {
        id: 'home',
        name: '家里',
        ingredients: [{ id: 'a', name: ' 番茄 ', weight: 300, createDate: NOW, updateDate: NOW, 垃圾字段: 'x' }],
        seasonings: [{ id: 'b', name: '盐', status: 'low', createDate: NOW, updateDate: NOW }],
      },
    ],
  },
  dishes: [
    {
      id: '番茄炒蛋',
      name: '番茄炒蛋',
      ingredients: [{ name: '番茄', estimatedWeight: 200, isInInventory: true, kcalPer100g: 20 }],
      seasonings: [],
      estimatedNutrition: { calories: 100, protein: 5, fat: 1, carbs: 10 },
      prepSteps: [{ description: '取[番茄(200g)]切块' }],
      cookingSteps: [{ instruction: '炒' }],
      basePersonCount: 2,
      timesCooked: 3,
      lastCookedAt: '2026-10-30T10:00:00.000Z',
      createdAt: '2026-10-01T10:00:00.000Z',
    },
  ],
  records: [
    { id: 'r1', name: '晚餐', createdAt: NOW, updatedAt: NOW, currentStage: 'menu', session: { id: 'r1' } },
    { id: '', name: '没有 id 的记录' },
  ],
  dietMemory: [{ name: '番茄炒蛋', timestamp: NOW }, { name: '', timestamp: NOW }],
};
const parsed = parseBackupJson(JSON.stringify(good), NOW);
assert.equal(parsed.kind, 'full');
assert.equal(parsed.payload.profiles.length, 1);
assert.equal(parsed.payload.profiles[0].ingredients[0].name, '番茄', '名字没 trim');
assert.equal(parsed.payload.profiles[0].ingredients[0].weight, 300);
assert.equal(parsed.payload.profiles[0].ingredients[0].垃圾字段, undefined, '白名单重建却把多余字段带进来了');
assert.equal(parsed.payload.dishes.length, 1);
assert.equal(parsed.payload.dishes[0].prepSteps[0].isCompleted, false, '导入的步骤要是未完成');
assert.equal(parsed.payload.records.length, 1, '没有 id 的记录该被丢掉');
assert.equal(parsed.payload.dietMemory.length, 1, '没有名字的饮食记忆该被丢掉');

// 2. 坏文件被挡住，且给的是人话
assert.throws(() => parseBackupJson(''), /空/);
assert.throws(() => parseBackupJson('{ 这不是 json'), /JSON/);
assert.throws(() => parseBackupJson(JSON.stringify({ hello: 1 })), /不是随煮/);
assert.throws(
  () => parseBackupJson(JSON.stringify({ ...good, version: BACKUP_VERSION + 1 })),
  /更新版本/,
  '未来版本的文件不该硬读',
);
assert.throws(() => parseBackupJson('x'.repeat(MAX_BACKUP_CHARS + 1)), /太大/);

// 3. 老格式（v1，顶层直接是 ingredients/seasonings）还能认，并进当前档案
const legacy = parseBackupJson(JSON.stringify({
  version: 1,
  ingredients: [{ name: '鸡蛋', weight: null }],
  seasonings: [{ name: '生抽', status: 'sufficient' }],
}), NOW);
assert.equal(legacy.kind, 'legacyInventory');
assert.equal(legacy.ingredients[0].name, '鸡蛋');
assert.equal(legacy.ingredients[0].weight, null);
assert.equal(legacy.seasonings[0].status, 'sufficient');

// 4. 原型污染：__proto__ 只能是普通属性，不能改到 Object.prototype
const evil = JSON.parse('{"__proto__":{"hacked":true},"name":"坏东西"}');
assert.equal({}.hacked, undefined);
const evilParsed = parseBackupJson(JSON.stringify({
  format: BACKUP_FORMAT,
  version: 2,
  inventory: { profiles: [{ name: '家', ingredients: [evil], seasonings: [] }] },
  dishes: [], records: [], dietMemory: [],
}), NOW);
assert.equal(({}).hacked, undefined, '原型被污染了');
assert.equal(evilParsed.payload.profiles[0].ingredients[0].name, '坏东西');
assert.equal(evilParsed.payload.profiles[0].ingredients[0].hacked, undefined, '白名单重建没挡住多余字段');

// 5. 库存合并：同名跳过，文件内部重复也只算一次，id 重新分配避免撞号
const added = mergeInventory(
  [{ name: '番茄' }, { name: '鸡蛋' }],
  [{ id: 'x', name: '番茄' }, { id: 'y', name: '土豆' }, { id: 'z', name: '土豆' }, { id: 'w', name: '  ' }],
  nextId,
);
assert.equal(added.length, 1, '只该新增土豆一条');
assert.equal(added[0].name, '土豆');
assert.notEqual(added[0].id, 'y', '导入的 id 要和文件里的不一样，否则可能和本地撞号');

// 6. 菜品合并：同 id 整条跳过（绝不覆盖你现在的配方），超出上限时淘汰最久没做的
const localDish = { id: '番茄炒蛋', name: '番茄炒蛋', lastCookedAt: '2026-10-01T00:00:00.000Z' };
const merged = mergeDishes(
  [localDish],
  [
    { id: '番茄炒蛋', name: '番茄炒蛋（别人的版本）', lastCookedAt: '2026-11-01T00:00:00.000Z' },
    { id: '红烧肉', name: '红烧肉', lastCookedAt: '2026-10-20T00:00:00.000Z' },
  ],
  200,
);
assert.equal(merged.length, 2);
assert.equal(merged.find((d) => d.id === '番茄炒蛋').name, '番茄炒蛋', '同 id 导入覆盖了本地配方');
assert.equal(merged[0].id, '红烧肉', '没按最近做过排序');
assert.equal(mergeDishes([], [{ id: 'a', lastCookedAt: '1' }, { id: 'b', lastCookedAt: '2' }], 1).length, 1, '上限没生效');

// 7. 记录合并：同 id 跳过，新的在前
const rec = (id, updatedAt) => ({ id, updatedAt });
const mergedRecords = mergeRecords([rec('r1', '2026-10-01')], [rec('r1', '2026-11-01'), rec('r2', '2026-10-15')]);
assert.equal(mergedRecords.length, 2);
assert.equal(mergedRecords[0].id, 'r2', '没按更新时间排序');
assert.equal(mergeRecords([rec('r1', '2026-10-01')], [rec('r1', '2026-11-01')]).length, 1, '同 id 记录被加了两次');

// 8. 饮食记忆：按 名字+时间 去重，只留最近 10 条
const diet = mergeDietMemory(
  [{ name: '番茄炒蛋', timestamp: '2026-11-01T10:00:00.000Z' }],
  [
    { name: '番茄炒蛋', timestamp: '2026-11-01T10:00:00.000Z' },
    { name: '红烧肉', timestamp: '2026-11-01T11:00:00.000Z' },
  ],
  10,
);
assert.equal(diet.length, 2);
assert.equal(diet[0].name, '红烧肉', '没按时间从新到旧');
const capped = mergeDietMemory([], Array.from({ length: 20 }, (_, i) => ({
  name: `菜${i}`, timestamp: new Date(Date.parse('2026-01-01') + i * 1000).toISOString(),
})), 10);
assert.equal(capped.length, 10);
assert.equal(capped[0].name, '菜19', '截断时丢掉的不是最旧的');

console.log('✓ 备份格式与导入合并规则 8 组全部通过');
