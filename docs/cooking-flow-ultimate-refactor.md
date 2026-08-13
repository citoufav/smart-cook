# 做菜流程彻底重构 + 深度思考修复方案

## 概述

1. **Bug 修复**：设置中的「深度思考」开关已保存但 LoadingOverlay 未根据开关控制显示，且 `showThinking` 属性未正确传递
2. **做菜流程重构**：删除称量(Stage2)和分装(Stage4)，改为一次性生成完整菜谱，纯查看模式（无打勾/互动），3 阶段可滑动/跳转

***

## 当前状态分析

### 现存问题

* **深度思考开关**：`settings.tsx` 中 `thinkingEnabled` 正确保存到 `preferences`，`aiService.ts` 中 `buildThinkingConfig()` 正确读取。但 `cooking.tsx` 和 `stage2-weighing.tsx` 中 `<LoadingOverlay>` 未传递 `showThinking` 属性，默认为 `true`，导致关闭深度思考时仍显示"AI 深度思考中..."窗口

* **Stage2 流式调用**：`stage2-weighing.tsx` 中的 LoadingOverlay 没有条件判断 thinkingEnabled

### 当前架构（5 阶段）

```
需求输入 → stage1-菜单方案 → stage2-称量确认 → stage3-备菜 → stage4-分装 → stage5-炒制 → 库存更新
STAGE_KEYS: ['menu', 'weighing', 'prep', 'bowl', 'cooking']
```

### 目标架构（3 阶段）

```
需求输入 → AI一次性生成完整菜谱 → [菜谱概览 | 备菜步骤 | 炒制步骤] 滑动/跳转查看 → 库存更新
STAGE_KEYS: ['menu', 'prep', 'cooking']
```

***

## 变更清单

### Part 1: 深度思考修复

#### 文件 1: `app/(tabs)/cooking.tsx`

* **改什么**：`<LoadingOverlay>` 添加 `showThinking={settingsState.preferences.thinkingEnabled}`

* **为什么**：让 LoadingOverlay 只在深度思考开启时展示思考链窗口

#### 文件 2: `app/cooking/stage2-weighing.tsx`

* **注意**：此文件将在 Part 2 中被删除，因此该修复不单独进行

***

### Part 2: 做菜流程重构

#### 文件 1: `src/types/index.ts`

* **改什么**：

  * 更新 `STAGE_INDEX_MAP`：只保留 `menu: 0, prep: 1, cooking: 2`

  * 更新 `STAGE_KEYS`：`['menu', 'prep', 'cooking']`

  * `CookingStage` 类型保留完整（不动），因为 `requirement/inventoryUpdate/completed/cancelled` 仍然需要

  * `GeneratedPlan` 中 `bowlAssignments` 字段保留但标记为可选（向后兼容历史数据）

* **为什么**：核心阶段从 5 个减为 3 个

#### 文件 2: `src/constants/cooking.ts`

* **改什么**：

  * 更新 `VALID_TRANSITIONS`：简化转换路径

    ```
    requirement → menu → cancelled
    menu → prep → requirement → cancelled
    prep → cooking → menu → cancelled
    cooking → inventoryUpdate → prep → cancelled
    inventoryUpdate → completed → cooking → cancelled
    ```

* **为什么**：移除 `weighing` 和 `bowl` 阶段的转换

#### 文件 3: `src/services/aiService.ts`

* **改什么**：

  * 重写 `SYSTEM_PROMPT_CN`：删除所有碗/分装相关规则，删除"备菜合并→分装分配"规则

  * 更新 Stage1 的 JSON Schema，让 AI 一次性返回完整的菜谱：

    ```json
    {
      "summary": { "description": "...", "cookingOrder": "...", "flavorNotes": "..." },
      "dishes": [
        {
          "name": "菜名",
          "ingredients": [...],
          "seasonings": [...],
          "estimatedNutrition": { "calories": ..., "protein": ..., "fat": ..., "carbs": ... }
        }
      ],
      "prepSteps": [
        {
          "id": "prep-1",
          "ingredientName": "食材名",
          "quantity": "200g",
          "description": "取[食材名(200g)]洗净，切...",
          "order": 1
        }
      ],
      "cookingSteps": [
        {
          "stepNumber": 1,
          "dishName": "对应菜品名",
          "instruction": "锅中加入[食用油(10g)]，烧至六成热..."
        }
      ],
      "preciseNutrition": [
        { "calories": ..., "protein": ..., "fat": ..., "carbs": ... }
      ],
      "missingItems": [...]
    }
    ```

  * **删除**以下函数（不再需要 Stage2）：

    * `callAIStage2()`

    * `callAIStage2Stream()`

    * `buildStage2UserPrompt()`

    * `callAIPatch()`

    * `generateAndValidatePlan()`

    * `buildIngredientTags()`

  * **保留但简化** `Stage1AIResult` 接口，增加 `prepSteps`、`cookingSteps`、`preciseNutrition` 字段

  * **重写** `buildStage1UserPrompt()`：prompt 中直接要求 AI 输出备菜+炒制步骤（不加碗引用）

* **为什么**：一次性生成全部内容，不需要第二轮 AI 调用

#### 文件 4: `src/components/CookingProgressBar.tsx`

* **改什么**：

  * `PROGRESS_STAGES` 更新为 3 个阶段：

    ```ts
    { key: 'menu', label: '菜谱', route: '/cooking/stage1-menu' },
    { key: 'prep', label: '备菜', route: '/cooking/stage3-prep' },
    { key: 'cooking', label: '炒制', route: '/cooking/stage5-cooking' },
    ```

* **为什么**：UI 上只显示 3 个阶段节点

#### 文件 5: `src/components/CookingPager.tsx`

* **改什么**：

  * `STAGE_LABELS` 更新为 `['菜谱概览', '备菜步骤', '炒制步骤']`

  * **全部改为只读模式**：所有阶段内容以 `mode='readonly'` 渲染

  * 删除 `LockedPlaceholder`（不再需要锁定概念）

  * 进度条点击跳转逻辑简化：`maxAccessibleIndex` 设为 `2`（始终可访问全部 3 个阶段）

  * 删除 `handleStageComplete` 回调（不再有阶段完成推进逻辑）

  * `getMode()` 统一返回 `'readonly'` 或简单返回 `'interactive'`（但内容组件都按只读渲染）

* **为什么**：菜谱是纯展示，不需要锁定/互动模式

#### 文件 6: `src/contexts/CookingContext.tsx`

* **改什么**：

  * 删除 action types：`TOGGLE_PREP_STEP`、`COMPLETE_ALL_PREP`、`TOGGLE_BOWL`、`COMPLETE_ALL_BOWLS`、`TOGGLE_COOKING_STEP`、`COMPLETE_ALL_COOKING_STEPS`、`INCREMENT_RETRY`、`RESET_RETRY`

  * 删除 `SET_STAGE2_RESULT` action

  * `SET_STAGE1_RESULT` 中直接设置完整方案（包含 prepSteps、cookingSteps）

  * 简化 `ensureCompletedStageIndex()` 迁移逻辑

  * 删除 `setStage2Result` 方法

  * 删除 `bowlValidationRetries` 状态

  * session 状态推进不再需要 `completedStageIndex`（因为不再有完成概念）

  * **或者更直接**：`completedStageIndex` 字段保留但仅用于进度条跳转

* **为什么**：不再需要步骤完成状态追踪

#### 文件 7: `app/(tabs)/cooking.tsx`

* **改什么**：

  * `handleStreamDone()` 中：

    * 将 AI 返回的 `prepSteps`、`cookingSteps`、`preciseNutrition` 存入 `generatedPlan`

    * 注入 `ingredientTags`（从 dishes 中提取）

    * 不再需要 Stage2 调用

  * **历史记录区域**：所有记录统一显示「查看」和「删除」两个按钮，移除「继续」按钮

    * 删除 `handleResume` 函数

    * `handleViewRecord` 不再区分完成/未完成

    * 所有记录都走 `router.push('/cooking/pager?historyMode=1')`

  * `STAGE_ROUTES` 常量更新

* **为什么**：一次生成全流程，统一记录入口

#### 文件 8: `app/cooking/stage1-menu.tsx`

* **改什么**：

  * **不再有确认按钮**（"确认菜单，开始称量"按钮删除）

  * 底部按钮改为导航到下一步（可选保留）

  * 基于 `generatedPlan` 中是否有数据，额外展示备菜步骤数量、炒制步骤数量的摘要

* **为什么**：菜单阶段变为纯展示概览

#### 文件 9: `app/cooking/stage3-prep.tsx`

* **改什么**：

  * **删除所有 Checkbox 和完成追踪逻辑**

  * 纯列表展示备菜步骤，带食材标签渲染

  * 删除底部"备菜完成，开始分装"按钮

  * 删除 `Stage3PrepContent` 中的互动逻辑

  * `Stage3PrepContent({ mode })` 中即使 mode='interactive' 也按只读渲染

* **为什么**：纯查看模式

#### 文件 10: `app/cooking/stage5-cooking.tsx`

* **改什么**：

  * **删除所有 Checkbox 和完成追踪逻辑**

  * 按菜品分组展示炒制步骤（保留折叠/展开交互）

  * 删除底部"大功告成！"按钮和 `CustomAlert`

  * 删除 `Stage5CookingContent` 中的互动逻辑

  * 指令中的 `[碗N]` 引用已不存在（AI 不再输出），食材标签 `[食材名(Xg)]` 保留

  * `InstructionText` 组件中移除碗标签解析分支，只保留食材标签渲染

* **为什么**：纯查看模式，不跟踪完成进度

#### 文件 11: `app/cooking/_layout.tsx`

* **改什么**：

  * 移除 `stage2-weighing`、`stage4-bowl` 的 Stack.Screen 注册

  * 确保 `stage1-menu`、`stage3-prep`、`stage5-cooking` 仍在路由中

* **为什么**：废弃页面不再对外暴露

#### 文件 12: `app/cooking/pager.tsx`

* **改什么**：兼容新的 3 阶段模型，转发 `historyMode` 给 CookingPager

* **为什么**：保持路由入口一致

#### 文件 13: `app/history/[id].tsx`

* **改什么**：

  * 在菜品列表下方增加备菜步骤和炒制步骤的展示（如果数据中存在）

  * 备菜/炒制步骤以只读列表形式展示

* **为什么**：历史记录详情页也需要展示完整菜谱

#### 文件 14: `src/services/cookingProgressService.ts`

* **改什么**：

  * `STAGE_LABELS` 更新为新的 3 阶段映射

  * 添加 `prep: '备菜'`、`cooking: '炒制'`（已存在无需改）

* **为什么**：错误提示和 UI 中用到这些标签

#### 文件 15: `app/cooking/stage2-weighing.tsx`

* **改什么**：**删除整个文件**

* **为什么**：称量阶段已废弃

#### 文件 16: `app/cooking/stage4-bowl.tsx`

* **改什么**：**删除整个文件**

* **为什么**：分装阶段已废弃

#### 文件 17: `app/cooking/inventory-update.tsx`

* **改什么**：

  * 更新 navigation 逻辑：做菜完成后不再有"回到做菜"的复杂跳转

  * 完成库存更新后回到首页

* **为什么**：流程已简化，no more intermediate stages

***

## 数据兼容性

* `GeneratedPlan.bowlAssignments` 字段保留但标记为可选（`bowlAssignments?: BowlAssignment[]`）

* 历史数据中如有 `weighing` 和 `bowl` 阶段的旧记录，在加载时自动跳过（不崩溃）

* `completedStageIndex` 保留在 `CookingSession` 中用于历史记录的进度条

***

## 不再需要的功能

* ❌ 步骤打勾完成追踪（checkbox）

* ❌ "继续做菜"断点续做（记录统一为查看）

* ❌ 阶段锁定/互动/只读三状态模型（统一只读）

* ❌ 碗引用验证（`bowlValidation.ts`）

* ❌ Stage2 AI 调用（称量→生成备菜/分装/炒制）

* ❌ AI 碗编号自动修复（`callAIPatch`）

***

## 验证步骤

1. 打开设置，关闭深度思考 → 生成菜单 → LoadingOverlay 应只显示简单文字"AI 正在思考中..."，不显示思考链窗口
2. 打开设置，开启深度思考 → 生成菜单 → LoadingOverlay 应显示思考链滚动窗口
3. 生成菜单后 → 直接进入 3 阶段菜谱页
4. 底部进度条显示「菜谱 | 备菜 | 炒制」3 个节点
5. 菜谱页可上下滑动查看全部内容，也可点击进度条跳转到备菜/炒制区域
6. 备菜步骤无复选框，纯文字展示
7. 炒制步骤按菜品分组可折叠展开，无复选框
8. 历史记录每条只有「查看」和「删除」按钮
9. 删除称量和分装页面的路由，无崩溃
10. 旧版本保存的进度记录（含 weighing/bowl 数据）加载时无误

