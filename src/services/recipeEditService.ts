import { MenuProposal } from '../types';

/** 对应 modify_recipe 工具 changes 数组中的单个修改项 */
export interface RecipeChange {
  type: 'adjust_ingredient' | 'replace_ingredient' | 'add_ingredient' | 'remove_ingredient' | 'update_step' | 'add_step' | 'remove_step' | 'rename_dish';
  dish?: string;          // 目标菜品名
  new_dish?: string;      // rename_dish 用
  ingredient?: string;    // 食材名
  new_weight?: number;    // adjust/add 用
  new_ingredient?: string; // replace 用
  step_number?: number;   // update/remove_step 用
  new_description?: string; // update/add_step 用
  add_after_step?: number;  // add_step 用
}

export interface RecipeChangeResult {
  proposal: MenuProposal;       // 修改后的新菜单方案（新对象，不修改入参）
  messages: string[];           // 每项修改的结果描述，如 "✅ 番茄炒蛋: 盐 → 3g"
}

/**
 * 将 modify_recipe 工具的 changes 应用到菜单方案（纯函数）。
 * 不修改入参 menuProposal：内部结构化克隆后操作，返回新对象。
 * 逻辑与 ChatSheet 原 executeToolCalls 中的修改逻辑等价。
 */
export function applyRecipeChanges(
  menuProposal: MenuProposal,
  changes: RecipeChange[],
): RecipeChangeResult {
  // 结构化克隆，与原组件 JSON.parse(JSON.stringify()) 行为一致
  const mp: any = JSON.parse(JSON.stringify(menuProposal || {}));
  const dishes: any[] = mp.dishes || [];
  const prepSteps: any[] = mp.prepSteps || [];
  const cookingSteps: any[] = mp.cookingSteps || [];

  const messages: string[] = [];

  for (const change of changes) {
    const dishName: string = change.dish || '';
    const dish = dishes.find((d: any) => d.name === dishName);

    switch (change.type) {
      case 'adjust_ingredient': {
        if (!dish) {
          messages.push(`⚠ 未找到菜品 ${dishName}`);
          break;
        }
        const ing = dish.ingredients?.find((i: any) => i.name === change.ingredient);
        if (ing && change.new_weight != null) {
          ing.estimatedWeight = change.new_weight;
          messages.push(`✅ ${dish.name}: ${change.ingredient} → ${change.new_weight}g`);
        } else if (!ing) {
          messages.push(`⚠ 未找到食材 ${change.ingredient}（${dish.name}）`);
        } else {
          messages.push(`⚠ 食材 ${change.ingredient} 缺少新用量`);
        }
        break;
      }
      case 'replace_ingredient': {
        if (!dish) {
          messages.push(`⚠ 未找到菜品 ${dishName}`);
          break;
        }
        const ing = dish.ingredients?.find((i: any) => i.name === change.ingredient);
        if (ing && change.new_ingredient) {
          ing.name = change.new_ingredient;
          messages.push(`✅ ${dish.name}: ${change.ingredient} → ${change.new_ingredient}`);
        } else if (!ing) {
          messages.push(`⚠ 未找到食材 ${change.ingredient}（${dish.name}）`);
        } else {
          messages.push(`⚠ 食材 ${change.ingredient} 缺少新名称`);
        }
        break;
      }
      case 'add_ingredient': {
        if (!dish) {
          messages.push(`⚠ 未找到菜品 ${dishName}`);
          break;
        }
        if (!dish.ingredients) dish.ingredients = [];
        if (change.ingredient && !dish.ingredients.find((i: any) => i.name === change.ingredient)) {
          dish.ingredients.push({ name: change.ingredient, estimatedWeight: change.new_weight || 10 });
          messages.push(`✅ ${dish.name}: 添加食材 ${change.ingredient}`);
        } else if (change.ingredient) {
          messages.push(`⚠ 食材 ${change.ingredient} 已存在（${dish.name}）`);
        } else {
          messages.push(`⚠ 添加食材失败：未指定食材名`);
        }
        break;
      }
      case 'remove_ingredient': {
        if (!dish) {
          messages.push(`⚠ 未找到菜品 ${dishName}`);
          break;
        }
        dish.ingredients = (dish.ingredients || []).filter((i: any) => i.name !== change.ingredient);
        messages.push(`✅ ${dish.name}: 移除食材 ${change.ingredient}`);
        break;
      }
      case 'update_step': {
        const stepNum = change.step_number;
        // 同时查备菜和炒制步骤
        let found = false;
        for (const steps of [prepSteps, cookingSteps]) {
          const target = steps.find((s: any) => (s.order ?? s.stepNumber) === stepNum);
          if (target && change.new_description) {
            target.description = change.new_description;
            target.instruction = change.new_description;
            found = true;
          }
        }
        if (found) messages.push(`✅ 步骤 ${stepNum} 已更新`);
        else messages.push(`⚠ 未找到步骤 ${stepNum}`);
        break;
      }
      case 'add_step': {
        if (change.add_after_step != null && change.new_description) {
          const afterStep = change.add_after_step;
          const newStep: any = {
            description: change.new_description,
            instruction: change.new_description,
            dishName: change.dish || '',
            id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            isCompleted: false,
          };
          // 判断是加在备菜还是炒制
          const inPrep = prepSteps.some((s: any) => (s.order ?? s.stepNumber) === afterStep);
          const inCook = cookingSteps.some((s: any) => (s.order ?? s.stepNumber) === afterStep);

          if (inPrep) {
            const idx = prepSteps.findIndex((s: any) => (s.order ?? s.stepNumber) === afterStep);
            newStep.order = afterStep + 1;
            if (idx >= 0) prepSteps.splice(idx + 1, 0, newStep);
            else prepSteps.push(newStep);
          } else if (inCook) {
            newStep.stepNumber = afterStep + 1;
            if (!cookingSteps.find((s: any) => (s.order ?? s.stepNumber) === afterStep + 1)) {
              cookingSteps.push(newStep);
            }
          } else {
            // 默认加到备菜
            prepSteps.push({ ...newStep, order: (prepSteps.length || 0) + 1 });
          }
          messages.push(`✅ 在步骤 ${afterStep} 后添加了新步骤`);
        } else {
          messages.push(`⚠ 添加步骤失败：缺少 add_after_step 或新描述`);
        }
        break;
      }
      case 'remove_step': {
        const stepNum = change.step_number;
        let removed = false;
        for (const arr of [prepSteps, cookingSteps]) {
          const before = arr.length;
          const filtered = arr.filter((s: any) => (s.order ?? s.stepNumber) !== stepNum);
          if (filtered.length < before) {
            arr.length = 0;
            arr.push(...filtered);
            removed = true;
          }
        }
        if (removed) messages.push(`✅ 步骤 ${stepNum} 已移除`);
        else messages.push(`⚠ 未找到步骤 ${stepNum}`);
        break;
      }
      case 'rename_dish': {
        if (dish && change.new_dish) {
          const oldName = dish.name;
          dish.name = change.new_dish;
          // 同步更新步骤里的 dishName
          for (const steps of [prepSteps, cookingSteps]) {
            for (const s of steps) {
              if (s.dishName === oldName) s.dishName = change.new_dish;
            }
          }
          messages.push(`✅ 菜品更名: ${oldName} → ${change.new_dish}`);
        } else if (!dish) {
          messages.push(`⚠ 未找到菜品 ${dishName}`);
        } else {
          messages.push(`⚠ 菜品更名失败：缺少新名称 new_dish`);
        }
        break;
      }
    }
  }

  mp.dishes = dishes;
  mp.prepSteps = prepSteps;
  mp.cookingSteps = cookingSteps;

  return { proposal: mp as MenuProposal, messages };
}
