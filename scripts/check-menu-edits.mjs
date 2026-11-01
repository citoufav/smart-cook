/**
 * 菜单编辑（menuEditService）的自检。跑法：
 *   node scripts/check-menu-edits.mjs
 *
 * 菜品是自包含模块（步骤就挂在这道菜里），热量由「克数 × 每100克大卡」实算。
 * 这里重点盯：局部改动不许波及其他菜、热量必须跟着克数变、
 * 采购清单勾选要保留、老版本的平铺数据能正确迁移且不丢进度。
 */
import assert from 'node:assert/strict';
import {
  applyEdits,
  migrateMenuProposal,
  attachStepsToDishes,
  computeCalories,
  recomputeNutrition,
  hasFullDensity,
} from '../src/services/menuEditService.ts';
import { pickNumber, readNumber } from '../src/utils/looseNumber.ts';

const requirement = { personCount: 2, mealType: 'dinner', caloriePreference: undefined, customRequirement: '' };

function dish(name, extra = {}) {
  return {
    id: `id-${name}`,
    name,
    ingredients: [],
    seasonings: [],
    estimatedNutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
    prepSteps: [],
    cookingSteps: [],
    ...extra,
  };
}

function baseMenu() {
  const tomato = dish('番茄炒蛋', {
    ingredients: [
      { name: '番茄', estimatedWeight: 200, isInInventory: true, kcalPer100g: 20 },
      { name: '鸡蛋', estimatedWeight: 100, isInInventory: true, kcalPer100g: 160 },
      { name: '盐', estimatedWeight: 2, isInInventory: false },
    ],
    seasonings: [{ name: '食用油', amount: '10g', isInInventory: true, kcalPer100g: 900 }],
    estimatedNutrition: { calories: 290, protein: 15, fat: 12, carbs: 30 },
    prepSteps: [
      { id: 'prep-1', ingredientName: '番茄', quantity: '200g', description: '取[番茄(200g)]洗净切块', isCompleted: false, order: 1 },
    ],
    cookingSteps: [{ stepNumber: 1, instruction: '下[食用油(10g)]，加[盐(2g)]炒匀', isCompleted: false }],
  });
  const cucumber = dish('凉拌黄瓜', {
    ingredients: [{ name: '黄瓜', estimatedWeight: 150, isInInventory: true, kcalPer100g: 100 }],
    seasonings: [{ name: '醋', amount: '适量', isInInventory: false, kcalPer100g: 30 }],
    estimatedNutrition: { calories: 150, protein: 3, fat: 1, carbs: 15 },
    prepSteps: [
      { id: 'prep-1', ingredientName: '黄瓜', quantity: '150g', description: '取[黄瓜(150g)]拍碎', isCompleted: false, order: 1 },
    ],
    cookingSteps: [{ stepNumber: 1, instruction: '把[黄瓜(150g)]拌好', isCompleted: false }],
  });
  return {
    dishes: [tomato, cucumber],
    estimatedNutrition: { calories: 440, protein: 18, fat: 13, carbs: 45 },
    missingItems: [
      { id: 'ingredient|盐', type: 'ingredient', name: '盐', suggestedAmount: '2g', forDish: '番茄炒蛋', isPurchased: true },
      { id: 'seasoning|醋', type: 'seasoning', name: '醋', suggestedAmount: '适量', forDish: '凉拌黄瓜', isPurchased: false },
    ],
    cookingOrderDescription: '',
    flavorDescription: '',
    summary: { description: 'd', cookingOrder: 'o', flavorNotes: 'f' },
  };
}

// 0. 热量按「克数 × 每100克 ÷ 100」算：番茄40 + 鸡蛋160 + 盐0 + 油90 = 290
//    凉拌黄瓜的醋是"适量"，解析不出克数 → 不计入，只算黄瓜 150
{
  const menu = baseMenu();
  assert.equal(computeCalories(menu.dishes[0]).kcal, 290);
  assert.equal(computeCalories(menu.dishes[1]).kcal, 150, '解析不出克数的调料被算进去了');
  assert.equal(hasFullDensity(menu.dishes[0]), false, '盐没有密度，不该算"全部有密度"');
}

// 1. 改克数：菜品的用量和它自己步骤里的文案一起改，别的菜一个字不动
let menu = applyEdits(baseMenu(), requirement, [
  { op: 'set_grams', dish: '番茄炒蛋', ingredient: '番茄', grams: 400 },
]);
assert.equal(menu.dishes[0].ingredients.find((i) => i.name === '番茄').estimatedWeight, 400);
assert.ok(menu.dishes[0].prepSteps[0].description.includes('[番茄(400g)]'), '步骤文案没跟着改');
assert.equal(menu.dishes[0].estimatedNutrition.calories, 330, `热量没跟着克数重算：${menu.dishes[0].estimatedNutrition.calories}`);
assert.equal(menu.dishes[1].cookingSteps[0].instruction, '把[黄瓜(150g)]拌好', '别的菜被动了');
assert.equal(menu.dishes[1].ingredients[0].estimatedWeight, 150, '别的菜用量被动了');

// 2. 盐没有热量密度：改它不改变热量，但步骤文案要改
menu = applyEdits(baseMenu(), requirement, [
  { op: 'set_grams', dish: '番茄炒蛋', ingredient: '盐', grams: 3 },
]);
assert.equal(menu.dishes[0].estimatedNutrition.calories, 290, '没有密度的食材不该影响热量');
assert.ok(menu.dishes[0].cookingSteps[0].instruction.includes('[盐(3g)]'), '步骤文案里的盐没跟着改');

// 3. 派生字段重算：总量营养 = 各菜之和
assert.equal(menu.estimatedNutrition.calories, 440);

// 4. 采购清单：已购入状态按名字保留，采购量跟着新用量
const salt = menu.missingItems.find((m) => m.name === '盐');
assert.ok(salt, '盐应仍在缺料清单里（isInInventory=false）');
assert.equal(salt.isPurchased, true, '已购入状态丢了');
assert.ok(salt.suggestedAmount.includes('3g'), '采购量没跟着用量更新');

// 5. 加食材：带密度就立刻计入热量
menu = applyEdits(baseMenu(), requirement, [
  { op: 'add_ingredient', dish: '凉拌黄瓜', ingredient: '蒜', grams: 10 },
]);
assert.ok(menu.dishes[1].ingredients.some((i) => i.name === '蒜'));
assert.equal(menu.dishes[1].estimatedNutrition.calories, 150, '新食材没有密度，热量不该凭空变');

// 6. 删菜：步骤跟着这道菜一起走，别的菜不受影响，采购清单不留残渣
menu = applyEdits(baseMenu(), requirement, [{ op: 'remove_dish', dish: '凉拌黄瓜' }]);
assert.equal(menu.dishes.length, 1);
assert.equal(menu.dishes[0].prepSteps.length, 1, '剩下的菜丢了备菜步骤');
assert.equal(menu.dishes[0].cookingSteps.length, 1);
assert.equal(menu.estimatedNutrition.calories, 290);
assert.ok(!menu.missingItems.some((m) => m.name === '醋'), '删掉的菜留下的调料还在采购清单');

// 7. 人数翻倍：用量、步骤文案、热量一起翻倍
menu = applyEdits(baseMenu(), requirement, [{ op: 'set_person_count', personCount: 4 }]);
assert.equal(menu.dishes[0].ingredients[0].estimatedWeight, 400);
assert.ok(menu.dishes[0].prepSteps[0].description.includes('[番茄(400g)]'), `步骤文案没缩放：${menu.dishes[0].prepSteps[0].description}`);
assert.equal(menu.dishes[0].prepSteps[0].quantity, '400g');
assert.equal(menu.dishes[0].estimatedNutrition.calories, 580, `翻倍后热量应约 2×290：${menu.dishes[0].estimatedNutrition.calories}`);
assert.equal(menu.dishes[0].seasonings[0].amount, '20g', '调料用量没跟着人数缩放');
assert.equal(menu.estimatedNutrition.calories, 880);

// 8. 菜内步骤编号：永远从 1 连续，不受别的菜影响
menu = applyEdits(baseMenu(), requirement, [{ op: 'remove_dish', dish: '番茄炒蛋' }]);
assert.deepEqual(menu.dishes[0].prepSteps.map((s) => s.order), [1]);
assert.deepEqual(menu.dishes[0].cookingSteps.map((s) => s.stepNumber), [1]);

// 9. 新增一道菜：接上生成出来的自包含菜品即可，不用再拼别的数组
const soup = dish('紫菜蛋花汤', {
  ingredients: [{ name: '紫菜', estimatedWeight: 50, isInInventory: false, kcalPer100g: 160 }],
  estimatedNutrition: { calories: 80, protein: 5, fat: 3, carbs: 8 },
  prepSteps: [{ id: 'prep-1', ingredientName: '紫菜', quantity: '5g', description: '取[紫菜(5g)]泡开', isCompleted: false, order: 1 }],
  cookingSteps: [{ stepNumber: 1, instruction: '水开后下[紫菜(5g)]', isCompleted: false }],
});
menu = applyEdits(baseMenu(), requirement, [{ op: 'add_dish', generated: soup }]);
assert.equal(menu.dishes.length, 3);
assert.equal(menu.dishes[2].cookingSteps.length, 1, '新菜没带上它自己的步骤');
assert.equal(menu.dishes[2].estimatedNutrition.calories, 80, '新菜的热量没按克数重算（50g × 160/100）');
assert.equal(menu.estimatedNutrition.calories, 520);

// 10. 改菜名：步骤不用动（步骤归属靠结构而不是菜名字符串）
menu = applyEdits(baseMenu(), requirement, [{ op: 'rename_dish', dish: '凉拌黄瓜', newName: '拍黄瓜' }]);
assert.equal(menu.dishes[1].name, '拍黄瓜');
assert.equal(menu.dishes[1].cookingSteps[0].instruction, '把[黄瓜(150g)]拌好');

// 11. 去掉食材：菜品、步骤文案、热量一起减
menu = applyEdits(baseMenu(), requirement, [
  { op: 'remove_ingredient', dish: '番茄炒蛋', ingredient: '鸡蛋' },
]);
assert.ok(!menu.dishes[0].ingredients.some((i) => i.name === '鸡蛋'));
assert.equal(menu.dishes[0].estimatedNutrition.calories, 130, `去掉鸡蛋后应只剩番茄40+油90：${menu.dishes[0].estimatedNutrition.calories}`);

// 12. 空编辑等于原样
menu = applyEdits(baseMenu(), requirement, []);
assert.deepEqual(menu.dishes, baseMenu().dishes);
assert.equal(menu.estimatedNutrition.calories, 440);

// 13. 没有密度的老菜：保留模型给的估算，不许变成 0
{
  const legacyDish = dish('老菜', {
    ingredients: [{ name: '神秘食材', estimatedWeight: 200, isInInventory: true }],
    estimatedNutrition: { calories: 350, protein: 20, fat: 12, carbs: 40 },
  });
  const after = recomputeNutrition(legacyDish);
  assert.equal(after.estimatedNutrition.calories, 350, '没有密度时不该动模型给的估算');
}

// 14. 老数据迁移：菜单级平铺步骤要搬进各自的菜，进度和勾选不能丢
const legacy = {
  dishes: [
    { name: '番茄炒蛋', ingredients: [{ name: '番茄', estimatedWeight: 200, isInInventory: true }], seasonings: [], estimatedNutrition: { calories: 300, protein: 15, fat: 12, carbs: 30 } },
    { name: '凉拌黄瓜', ingredients: [{ name: '黄瓜', estimatedWeight: 150, isInInventory: true }], seasonings: [], estimatedNutrition: { calories: 100, protein: 3, fat: 1, carbs: 15 } },
  ],
  prepSteps: [
    { id: 'prep-1', ingredientName: '番茄', quantity: '200g', dishName: '番茄炒蛋', description: '取[番茄(200g)]切块', isCompleted: true, order: 1 },
    { id: 'prep-2', ingredientName: '黄瓜', quantity: '150g', dishName: '凉拌黄瓜', description: '取[黄瓜(150g)]拍碎', isCompleted: false, order: 2 },
  ],
  cookingSteps: [
    { stepNumber: 1, dishName: '番茄炒蛋', instruction: '炒蛋', isCompleted: true },
    { stepNumber: 2, dishName: '凉拌黄瓜', instruction: '拌黄瓜', isCompleted: false },
  ],
  missingItems: [],
  summary: { description: '', cookingOrder: '', flavorNotes: '' },
};
const migrated = migrateMenuProposal(legacy);
assert.equal(migrated.dishes.length, 2);
assert.equal(migrated.dishes[0].prepSteps.length, 1, '老数据的备菜步骤丢了');
assert.equal(migrated.dishes[0].prepSteps[0].isCompleted, true, '老数据的备菜勾选进度丢了');
assert.equal(migrated.dishes[1].prepSteps[0].description, '取[黄瓜(150g)]拍碎');
assert.equal(migrated.dishes[0].cookingSteps[0].instruction, '炒蛋');
assert.equal(migrated.dishes[1].cookingSteps[0].isCompleted, false);
assert.ok(migrated.dishes.every((d) => typeof d.id === 'string' && d.id.length > 0), '迁移后菜品没拿到 id');
assert.equal(migrated.estimatedNutrition.calories, 400, '迁移后总量营养没重算');

// 15. 已经是新结构的数据再过一遍迁移必须不变（幂等）
const twice = migrateMenuProposal(migrated);
assert.equal(twice.dishes[0].prepSteps.length, 1);
assert.equal(twice.dishes[0].id, migrated.dishes[0].id, '重复迁移把菜品 id 换了');

// 16. 步骤找不到所属菜品：挂到第一道菜，但不许静默丢掉
const orphanHosts = [dish('A'), dish('B')];
const orphanCount = attachStepsToDishes(
  orphanHosts,
  [{ dishName: '不存在的菜', description: '孤儿步骤' }],
  [],
);
assert.equal(orphanCount, 1, '孤儿步骤没有被告警');
assert.equal(orphanHosts[0].prepSteps.length, 1);
assert.equal(orphanHosts[1].prepSteps.length, 0);

// 17. 模型把数字写成字符串时必须能读出来 —— 这就是"加一道菜生成出来全是 0 克"的根因
//     （z.coerce.number('200g') 是 NaN，兜底成 0）
assert.equal(readNumber('200g'), 200);
assert.equal(readNumber('约 200 克'), 200);
assert.equal(readNumber('290大卡'), 290);
assert.equal(readNumber(200), 200);
assert.equal(readNumber('适量'), 0, '解析不出数字的文本必须当 0，不能瞎猜');
assert.equal(readNumber(undefined), 0);
assert.equal(pickNumber({ weight: '200g' }, ['estimatedWeight', 'weight']), 200, '同义键没被读到');
assert.equal(
  pickNumber({ estimatedWeight: 0, grams: '150g' }, ['estimatedWeight', 'grams']),
  150,
  '前一个键是 0 不该挡住后面的同义键',
);

console.log('✓ 菜单编辑 17 项全部通过');