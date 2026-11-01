/**
 * 给模型看的**唯一格式范例**。
 *
 * 格式规范不靠一条条规则去说，而是给一份看起来就像真答案的完整输出让模型照抄结构。
 * 骨架式的占位符（"食材名"/"克数（如200g）"）反而会教模型在字符串里写说明文字。
 *
 * 这份范例特意让「番茄」「鸡蛋」同时出现在两道菜里、且用量不同 —— 这是最容易被
 * 模型合并掉的规范（把两道菜的番茄合成一条"取[番茄(300g)]"），必须用例子钉死。
 *
 * 单独放一个没有依赖的文件，是为了让 scripts/check-menu-edits.mjs 能直接
 * JSON.parse 它：范例本身不合法（少个逗号、字段名写错）的话，生成质量会悄悄变差，
 * 而这种错误在界面上看不出来。
 */
export const MENU_FORMAT_EXAMPLE = `{
  "summary": {
    "description": "两道番茄鸡蛋，一干一汤，二十来分钟能上桌",
    "cookingOrder": "先炒番茄炒蛋，趁热再煮蛋花汤",
    "flavorNotes": "酸甜基础味，汤清淡解腻"
  },
  "dishes": [
    {
      "name": "番茄炒蛋",
      "ingredients": [
        { "name": "番茄", "estimatedWeight": 200, "kcalPer100g": 20, "isInInventory": true },
        { "name": "鸡蛋", "estimatedWeight": 150, "kcalPer100g": 143, "isInInventory": true }
      ],
      "seasonings": [
        { "name": "食用油", "amount": "10g", "kcalPer100g": 899, "isInInventory": true },
        { "name": "盐", "amount": "2g", "kcalPer100g": 0, "isInInventory": false }
      ],
      "estimatedNutrition": { "calories": 344, "protein": 21, "fat": 25, "carbs": 6 }
    },
    {
      "name": "番茄蛋花汤",
      "ingredients": [
        { "name": "番茄", "estimatedWeight": 100, "kcalPer100g": 20, "isInInventory": true },
        { "name": "鸡蛋", "estimatedWeight": 50, "kcalPer100g": 143, "isInInventory": true }
      ],
      "seasonings": [
        { "name": "清水", "amount": "300g", "kcalPer100g": 0, "isInInventory": true },
        { "name": "盐", "amount": "1g", "kcalPer100g": 0, "isInInventory": false }
      ],
      "estimatedNutrition": { "calories": 92, "protein": 8, "fat": 5, "carbs": 4 }
    }
  ],
  "prepSteps": [
    { "id": "prep-1", "ingredientName": "番茄", "quantity": "200g", "dishName": "番茄炒蛋", "description": "取[番茄(200g)]洗净切块", "isCompleted": false, "order": 1 },
    { "id": "prep-2", "ingredientName": "鸡蛋", "quantity": "150g", "dishName": "番茄炒蛋", "description": "把[鸡蛋(150g)]打散备用", "isCompleted": false, "order": 2 },
    { "id": "prep-3", "ingredientName": "番茄", "quantity": "100g", "dishName": "番茄蛋花汤", "description": "取[番茄(100g)]切小丁", "isCompleted": false, "order": 3 },
    { "id": "prep-4", "ingredientName": "鸡蛋", "quantity": "50g", "dishName": "番茄蛋花汤", "description": "把[鸡蛋(50g)]打散备用", "isCompleted": false, "order": 4 }
  ],
  "cookingSteps": [
    { "stepNumber": 1, "dishName": "番茄炒蛋", "instruction": "锅烧热后下[食用油(10g)]，六成热（约160°C）倒入[鸡蛋(150g)]炒至凝固盛出", "isCompleted": false },
    { "stepNumber": 2, "dishName": "番茄炒蛋", "instruction": "锅中留底油，下[番茄(200g)]中火炒3分钟至出汁，倒回鸡蛋，加[盐(2g)]炒匀", "isCompleted": false },
    { "stepNumber": 3, "dishName": "番茄蛋花汤", "instruction": "另起锅加[清水(300g)]大火煮沸，放入[番茄(100g)]煮2分钟", "isCompleted": false },
    { "stepNumber": 4, "dishName": "番茄蛋花汤", "instruction": "转小火，淋入[鸡蛋(50g)]成蛋花，加[盐(1g)]调味", "isCompleted": false }
  ],
  "missingItems": [
    { "type": "seasoning", "name": "盐", "suggestedAmount": "3g", "forDish": "番茄炒蛋" },
    { "type": "seasoning", "name": "盐", "suggestedAmount": "1g", "forDish": "番茄蛋花汤" }
  ],
  "cookingOrderDescription": "先炒后汤",
  "flavorDescription": "酸甜清淡"
}`;
