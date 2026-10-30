/**
 * 菜单编辑（menuEditService）的自检。跑法：
 *   node scripts/check-menu-edits.mjs
 *
 * 重点盯：局部改动不许波及其他菜、派生字段必须重算、采购清单勾选要保留。
 */
import assert from 'node:assert/strict';
import { applyEdits, diffEdits, isApplicableEdit } from '../src/services/menuEditService.ts';

const requirement = { personCount: 2, mealType: 'dinner', caloriePreference: undefined, customRequirement: '' };

function baseMenu() {
  return {
    dishes: [
      {
        name: '番茄炒蛋',
        ingredients: [
          { name: '番茄', estimatedWeight: 200, isInInventory: true },
          { name: '鸡蛋', estimatedWeight: 100, isInInventory: true },
          { name: '盐', estimatedWeight: 2, isInInventory: false },
        ],
        seasonings: [{ name: '食用油', amount: '10g', isInInventory: true }],
        estimatedNutrition: { calories: 300, protein: 15, fat: 12, carbs: 30 },
      },
      {
        name: '凉拌黄瓜',
        ingredients: [{ name: '黄瓜', estimatedWeight: 150, isInInventory: true }],
        seasonings: [{ name: '醋', amount: '适量', isInInventory: false }],
        estimatedNutrition: { calories: 100, protein: 3, fat: 1, carbs: 15 },
      },
    ],
    estimatedNutrition: { calories: 400, protein: 18, fat: 13, carbs: 45 },
    missingItems: [
      { id: 'ingredient-盐-番茄炒蛋-0', type: 'ingredient', name: '盐', suggestedAmount: '2g', forDish: '番茄炒蛋', isPurchased: true },
      { id: 'seasoning-醋-凉拌黄瓜-1', type: 'seasoning', name: '醋', suggestedAmount: '适量', forDish: '凉拌黄瓜', isPurchased: false },
    ],
    cookingOrderDescription: '',
    flavorDescription: '',
    summary: { description: 'd', cookingOrder: 'o', flavorNotes: 'f' },
    prepSteps: [
      { id: 'prep-1', ingredientName: '番茄', quantity: '200g', dishName: '番茄炒蛋', description: '取[番茄(200g)]洗净切块', isCompleted: false, order: 1 },
      { id: 'prep-2', ingredientName: '黄瓜', quantity: '150g', dishName: '凉拌黄瓜', description: '取[黄瓜(150g)]拍碎', isCompleted: false, order: 2 },
    ],
    cookingSteps: [
      { stepNumber: 1, dishName: '番茄炒蛋', instruction: '下[食用油(10g)]，加[盐(2g)]炒匀', isCompleted: false },
      { stepNumber: 2, dishName: '凉拌黄瓜', instruction: '把[黄瓜(150g)]拌好', isCompleted: false },
    ],
    preciseNutrition: [
      { calories: 300, protein: 15, fat: 12, carbs: 30 },
      { calories: 100, protein: 3, fat: 1, carbs: 15 },
    ],
  };
}

// 1. 改克数：菜品和步骤文案一起改，别的菜一个字不动
let menu = applyEdits(baseMenu(), requirement, [
  { op: 'set_grams', dish: '番茄炒蛋', ingredient: '盐', grams: 3 },
]);
assert.equal(menu.dishes[0].ingredients.find((i) => i.name === '盐').estimatedWeight, 3);
assert.ok(menu.cookingSteps[0].instruction.includes('[盐(3g)]'), '步骤文案里的盐没跟着改');
assert.equal(menu.cookingSteps[1].instruction, '把[黄瓜(150g)]拌好', '别的菜被动了');
assert.equal(menu.dishes[1].ingredients[0].estimatedWeight, 150, '别的菜用量被动了');

// 2. 派生字段重算：总量营养 = 各菜之和
assert.equal(menu.estimatedNutrition.calories, 400);

// 3. 采购清单：已购入状态按名字保留
const salt = menu.missingItems.find((m) => m.name === '盐');
assert.ok(salt, '盐应仍在缺料清单里（isInInventory=false）');
assert.equal(salt.isPurchased, true, '已购入状态丢了');
assert.ok(salt.suggestedAmount.includes('3g'), '采购量没跟着用量更新');

// 4. 删菜：连带步骤和营养一起删，索引对齐
menu = applyEdits(baseMenu(), requirement, [{ op: 'remove_dish', dish: '凉拌黄瓜' }]);
assert.equal(menu.dishes.length, 1);
assert.equal(menu.prepSteps.length, 1);
assert.equal(menu.cookingSteps.length, 1);
assert.equal(menu.preciseNutrition.length, 1);
assert.equal(menu.estimatedNutrition.calories, 300);
assert.ok(!menu.missingItems.some((m) => m.name === '醋'), '删掉的菜留下的调料还在采购清单');

// 5. 人数翻倍：用量、步骤文案、营养一起缩放
menu = applyEdits(baseMenu(), requirement, [{ op: 'set_person_count', personCount: 4 }]);
assert.equal(menu.dishes[0].ingredients[0].estimatedWeight, 400);
assert.ok(menu.prepSteps[0].description.includes('[番茄(400g)]'), `步骤文案没缩放：${menu.prepSteps[0].description}`);
assert.equal(menu.prepSteps[0].quantity, '400g');
assert.equal(menu.estimatedNutrition.calories, 800);
assert.equal(menu.preciseNutrition[0].calories, 600);

// 6. 步骤重新编号：删掉中间一道菜后 order/stepNumber 必须连续
menu = applyEdits(baseMenu(), requirement, [{ op: 'remove_dish', dish: '番茄炒蛋' }]);
assert.deepEqual(menu.prepSteps.map((s) => s.order), [1]);
assert.deepEqual(menu.cookingSteps.map((s) => s.stepNumber), [1]);

// 7. 新增一道菜（带生成结果）
menu = applyEdits(baseMenu(), requirement, [
  {
    op: 'add_dish',
    instruction: '来个汤',
    generated: {
      dish: {
        name: '紫菜蛋花汤',
        ingredients: [{ name: '紫菜', estimatedWeight: 5, isInInventory: false }],
        seasonings: [],
        estimatedNutrition: { calories: 80, protein: 5, fat: 3, carbs: 8 },
      },
      prepSteps: [{ id: 'prep-1', ingredientName: '紫菜', quantity: '5g', dishName: '紫菜蛋花汤', description: '取[紫菜(5g)]泡开', isCompleted: false, order: 1 }],
      cookingSteps: [{ stepNumber: 1, dishName: '紫菜蛋花汤', instruction: '水开后下[紫菜(5g)]', isCompleted: false }],
    },
  },
]);
assert.equal(menu.dishes.length, 3);
assert.equal(menu.estimatedNutrition.calories, 480);
assert.ok(menu.missingItems.some((m) => m.name === '紫菜'));
assert.equal(menu.cookingSteps.length, 3);
assert.deepEqual(menu.cookingSteps.map((s) => s.stepNumber), [1, 2, 3]);

// 8. 去掉食材：菜品和步骤文案里都不该再出现
menu = applyEdits(baseMenu(), requirement, [
  { op: 'remove_ingredient', dish: '番茄炒蛋', ingredient: '盐' },
]);
assert.ok(!menu.dishes[0].ingredients.some((i) => i.name === '盐'));
assert.ok(!menu.cookingSteps[0].instruction.includes('[盐('), '步骤里还引用着已去掉的食材');

// 9. 空编辑等于原样
menu = applyEdits(baseMenu(), requirement, []);
assert.deepEqual(menu.dishes, baseMenu().dishes);
assert.equal(menu.estimatedNutrition.calories, 400);

// 10. 预览行：改克数要显示前后值
const lines = diffEdits(baseMenu(), [{ op: 'set_grams', dish: '番茄炒蛋', ingredient: '盐', grams: 3 }]);
assert.equal(lines.length, 1);
assert.ok(lines[0].text.includes('2g') && lines[0].text.includes('3g'), `预览没给出前后值：${lines[0].text}`);
assert.equal(lines[0].dish, '番茄炒蛋');

// 11. 可落地性过滤：菜名/食材名对不上的动作要被挡掉，不能拿"（未找到）"去让用户确认
const menu0 = baseMenu();
assert.equal(isApplicableEdit(menu0, { op: 'set_grams', dish: '番茄炒蛋', ingredient: '盐', grams: 3 }), true);
assert.equal(isApplicableEdit(menu0, { op: 'set_grams', dish: '不存在的菜', ingredient: '盐', grams: 3 }), false);
assert.equal(isApplicableEdit(menu0, { op: 'set_grams', dish: '番茄炒蛋', ingredient: '味精', grams: 3 }), false);
assert.equal(isApplicableEdit(menu0, { op: 'add_ingredient', dish: '番茄炒蛋', ingredient: '味精', grams: 1 }), true);
assert.equal(isApplicableEdit(menu0, { op: 'remove_dish', dish: '凉拌黄瓜' }), true);
assert.equal(isApplicableEdit(menu0, { op: 'set_person_count', personCount: 5 }), true);

console.log('✓ 菜单编辑 11 项全部通过');
