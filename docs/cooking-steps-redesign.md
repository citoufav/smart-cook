# 做菜步骤系统重构方案

## 概述

重构 Stage2-5 的做菜步骤系统，核心改动：

1. 称量后食材变为带颜色和克重的**食材标签**（如 `[大米(200g)]`），AI 生成步骤时用标签引用食材
2. 备菜步骤不再提及碗编号，分装阶段单独处理碗和水量
3. 用底部**步骤进度条**替代当前的只读导航条，可点击跳转查看已完成步骤
4. AI 提示词强化：步骤必须详细、食材克重明确、水量精确

***

## 当前状态分析

### 数据流

```
Stage1 → menuProposal (菜谱)
Stage2 → 用户称量 + AI 生成 → WeighingData + GeneratedPlan (prepSteps / bowlAssignments / cookingSteps)
Stage3 → 读取 generatedPlan.prepSteps → 逐项勾选
Stage4 → 读取 generatedPlan.bowlAssignments → 逐项勾选
Stage5 → 读取 generatedPlan.cookingSteps → 逐项勾选
```

### 当前问题

| 问题                  | 根因                                |
| ------------------- | --------------------------------- |
| 备菜步骤"温水泡发30分钟"不写是什么 | AI 提示词中 description 示例没要求引用食材     |
| 备菜步骤写了碗编号           | prepSteps JSON schema 没有禁止碗编号规则   |
| "水米1:1.2" 新手看不懂     | AI 提示词没要求给出精确水量克数                 |
| 只读导航条体验差            | 每个页面独立的 readonlyBar，操作不直观         |
| 分装阶段没有水量            | bowlAssignments 没有水量字段，AI 提示词也没要求 |

***

## 改动方案

### 1. 新增类型定义

**文件**: `src/types/index.ts`

新增 `IngredientTag`：

```ts
export interface IngredientTag {
  name: string;
  weight: number;
  color: string; // 分配给该食材的颜色 hex 值
}
```

`GeneratedPlan` 新增字段：

```ts
export interface GeneratedPlan {
  prepSteps: PrepStep[];
  bowlAssignments: BowlAssignment[];
  cookingSteps: CookingStep[];
  preciseNutrition: NutritionInfo[];
  ingredientTags: IngredientTag[]; // 新增：带颜色和克重的食材标签列表
}
```

`BowlAssignment` 新增可选字段（用于提示 AI 分装时考虑水量）：

```ts
export interface BowlAssignment {
  bowlNumber: number;
  dishName: string;
  contents: string;
  ingredients: string[];
  waterAmount?: string; // 新增：如 "200g"
  isCompleted: boolean;
}
```

### 2. 食材标签颜色分配

**文件**: 新增 `src/constants/ingredientColors.ts`

定义食材标签调色板（8 种颜色循环使用）：

```ts
export const INGREDIENT_TAG_COLORS = [
  '#FF6B35', // 橙色（主色）
  '#2196F3', // 蓝色
  '#2D9F4E', // 绿色
  '#9C27B0', // 紫色
  '#FF9800', // 琥珀
  '#E91E63', // 粉色
  '#00BCD4', // 青色
  '#795548', // 棕色
];
```

### 3. 食材标签生成逻辑

**文件**: `src/services/aiService.ts`（在 `buildStage2UserPrompt` 附近）

新增函数 `buildIngredientTags(input: Stage2AIInput): IngredientTag[]`：

* 遍历 `input.dishes`，收集所有 `{ name, actualGrams }`

* 按名称去重合并（同一食材跨菜品累加克数）

* 按顺序分配颜色（用 `INGREDIENT_TAG_COLORS` 取模）

在 `buildStage2UserPrompt` 中新增一段食材标签列表：

```
【食材标签（请在步骤中用 [食材名(克重)] 格式引用，如 [大米(200g)]）】
- 大米：200g
- 木耳：50g
- 猪肉：150g
```

### 4. AI 提示词改造

**文件**: `src/services/aiService.ts`

#### SYSTEM\_PROMPT\_CN 新增规则（追加到现有 13 条之后）：

```
14. **备菜步骤格式**：description 中引用食材请使用 [食材名(克重)] 格式，如 "淘洗[大米(200g)]，沥干备用"。
    严禁在 prepSteps 中提及碗编号或碗分配，碗相关内容统一在 bowlAssignments 中处理。
15. **精确用量**：所有食材用量以克为单位给出精确数字（如 "加水 200g"，不要写 "水米 1:1.2"）。
    调料使用 "适量"、"少许"、"X勺" 等日常描述。
16. **步骤详细**：新手也能看懂，每个步骤写出具体操作（如 "加入200g冷水，搅拌使米粒均匀分布"）。
17. **分装水量**：bowlAssignments.contents 中显式列出需要加的水量（如 "大米200g + 清水240g"），
    waterAmount 字段单独填写水量克数。
18. **炒制步骤**：cookingSteps.instruction 中引用碗用 [碗N] 格式，引用食材用 [食材名(克重)] 格式。
```

#### buildStage2UserPrompt JSON Schema 改动：

```json
{
  "prepSteps": [
    {
      "id": "prep-1",
      "ingredientName": "食材名称",
      "quantity": "用量（如 200g）",
      "description": "切配操作，食材用 [食材名(克重)] 引用，严禁提碗编号",
      "isCompleted": false,
      "order": 1
    }
  ],
  "bowlAssignments": [
    {
      "bowlNumber": 1,
      "dishName": "菜品名",
      "contents": "碗中内容（含水量如 '大米200g + 清水240g'）",
      "ingredients": ["食材名1"],
      "waterAmount": "水量克数（如 '240g'）",
      "isCompleted": false
    }
  ],
  "cookingSteps": [
    {
      "stepNumber": 1,
      "dishName": "菜品名",
      "instruction": "炒制步骤，碗用 [碗N] 引用，食材用 [食材名(克重)] 引用",
      "bowlReferences": [1],
      "isCompleted": false
    }
  ],
  "preciseNutrition": [
    { "calories": 大卡数, "protein": 克, "fat": 克, "carbs": 克 }
  ]
}
```

新增规则：

```
5. prepSteps.description 中使用 [食材名(克重)] 格式引用食材，严禁提及碗编号
6. bowlAssignments 需包含水量（如果该碗需要加水），waterAmount 单独填写
7. cookingSteps.instruction 中用 [碗N] 引用碗，用 [食材名(克重)] 引用食材
8. 所有食材用量以克为精确单位，新手友好
```

### 5. Stage2 称量 —— 生成食材标签

**文件**: `app/cooking/stage2-weighing.tsx`

在 `onSuccess` 中，构建 `Stage2AIInput` 后调用 `buildIngredientTags()` 生成标签：

```ts
// 在 onSuccess 中，save 之前：
const input = { dishes: ..., availableSeasonings, ... };
const ingredientTags = buildIngredientTags(input);

const updatedSession = {
  ...cookingState.session,
  status: 'prep' as const,
  stages: {
    ...cookingState.session.stages,
    weighing: weighingData,
    generatedPlan: {
      ...response,
      ingredientTags, // 附加食材标签
    },
  },
  updatedAt: new Date().toISOString(),
};
```

同样在 `setStage2Result()` 调用时也需要带上 ingredientTags。

### 6. Stage3 备菜 —— 食材标签渲染

**文件**: `app/cooking/stage3-prep.tsx`

新增 `IngredientTagText` 组件（内联），解析 description 中的 `[食材名(克重)]` 模式：

* 用正则 `/\[(.+?)\((\d+)g\)\]/g` 匹配

* 匹配到的部分渲染为带背景色的 `<Text>` 标签

* 从 `generatedPlan.ingredientTags` 查找对应颜色

示例渲染：

```
淘洗 → 橙底 [大米(200g)] ← 沥干备用
```

### 7. Stage4 分装 —— 水量显示 + 碗标签

**文件**: `app/cooking/stage4-bowl.tsx`

* `contents` 中如果包含水量（已在 AI 提示词中要求），展示时分两行：

  * 主行：食材内容

  * 副行：水量（用蓝色小字）

* 碗编号展示改为带颜色的标签样式（从 ingredientTags 调色板衍生碗颜色）

### 8. Stage5 炒制 —— 碗标签 + 食材标签渲染

**文件**: `app/cooking/stage5-cooking.tsx`

* 解析 `instruction` 中的 `[碗N]` 模式，渲染为颜色标签

* 解析 `[食材名(克重)]` 模式，渲染为食材标签（同 Stage3）

* 碗颜色 = 该碗中第一个食材的颜色

### 9. 底部进度条 —— 替代只读导航

**文件**: 新增 `src/components/CookingProgressBar.tsx`

#### 设计

```
┌─────────────────────────────────────────┐
│  ●────────●────────○────────○          │
│ 称量    备菜    分装    制作            │
└─────────────────────────────────────────┘
```

* 固定在屏幕底部（`position: absolute, bottom: 0`）

* 4 个阶段节点，连线连接

* 当前阶段：橙色大圆点 + 橙色文字

* 已完成阶段：浅橙色（`primaryLight`）实心圆点 + 浅色文字

* 未完成阶段：灰色（`border`）空心圆点 + 灰色文字

* 点击已完成/当前阶段 → `router.push` 到对应 stage（带 `?readonly=1`）

* 点击未完成阶段 → 无反应

#### Props

```ts
interface CookingProgressBarProps {
  currentStage: 'weighing' | 'prep' | 'bowl' | 'cooking';
  completedStages: string[]; // 已完成的 stage 列表
}
```

#### 阶段映射

```ts
const PROGRESS_STAGES = [
  { key: 'weighing', label: '称量', route: '/cooking/stage2-weighing' },
  { key: 'prep', label: '备菜', route: '/cooking/stage3-prep' },
  { key: 'bowl', label: '分装', route: '/cooking/stage4-bowl' },
  { key: 'cooking', label: '制作', route: '/cooking/stage5-cooking' },
];
```

### 10. 移除所有只读导航条

**涉及文件**:

* `app/cooking/stage2-weighing.tsx` — 删除 readonlyBar JSX 和样式

* `app/cooking/stage3-prep.tsx` — 删除 readonlyBar JSX、handleGoPrev、handleGoNext、handleContinueEditing、handleBackToPrevReadonly；删除 bottomButtonRow 中的 "← 查看称量" 按钮

* `app/cooking/stage4-bowl.tsx` — 同上，删除 "← 查看备菜"

* `app/cooking/stage5-cooking.tsx` — 同上，删除 "← 查看分装"

每个 stage 底部新增 `<CookingProgressBar>` 组件。

### 11. 底部按钮布局调整

Stage3/4/5 底部改为单按钮（进度条放在按钮上方）：

```
┌──────────────────────────────┐
│  [备菜完成，开始分装]        │  ← 主按钮
├──────────────────────────────┤
│  ●────●────○────○            │  ← 进度条
│ 称量  备菜  分装  制作        │
└──────────────────────────────┘
```

进度条高度约 56px，位于 `bottomBar` 内部或使用 `position: absolute` 避免遮挡内容。

### 12. cooking.tsx 记录查看适配

**文件**: `app/(tabs)/cooking.tsx`

`handleViewRecord` 保持不变（仍使用 `?readonly=1` 跳转），因为进度条上点击已完成的 stage 会进入只读模式，只读模式下显示进度条让用户可以继续浏览。

***

## 涉及文件总览

| 文件                                      | 操作     | 说明                                                                                                             |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `src/types/index.ts`                    | 修改     | 新增 `IngredientTag`，`GeneratedPlan` 加 `ingredientTags`，`BowlAssignment` 加 `waterAmount`                         |
| `src/constants/ingredientColors.ts`     | **新建** | 食材标签调色板                                                                                                        |
| `src/services/aiService.ts`             | 修改     | 新增 `buildIngredientTags()`，修改 `SYSTEM_PROMPT_CN`（追加 14-18），修改 `buildStage2UserPrompt`（食材标签列表 + 更新 JSON Schema） |
| `src/components/CookingProgressBar.tsx` | **新建** | 底部进度条组件                                                                                                        |
| `app/cooking/stage2-weighing.tsx`       | 修改     | onSuccess 中生成 ingredientTags；底部加进度条；移除 readonlyBar                                                             |
| `app/cooking/stage3-prep.tsx`           | 修改     | description 解析食材标签渲染；移除 readonlyBar；底部加进度条                                                                     |
| `app/cooking/stage4-bowl.tsx`           | 修改     | contents 水量展示；移除 readonlyBar；底部加进度条                                                                            |
| `app/cooking/stage5-cooking.tsx`        | 修改     | instruction 解析碗标签 + 食材标签；移除 readonlyBar；底部加进度条                                                                 |
| `src/contexts/CookingContext.tsx`       | 可能需要修改 | `SET_STAGE2_RESULT` 传递 ingredientTags                                                                          |
| `app/cooking/_layout.tsx`               | 无修改    | 布局保持当前状态（已允许返回）                                                                                                |

***

## 验证步骤

1. `npx tsc --noEmit` — TypeScript 编译通过（仅允许预存错误）
2. 完整走一遍流程：

   * Stage1 生成菜单 → 进入 Stage2

   * Stage2 称量完成 → 检查日志确认 ingredientTags 已生成并存入 session

   * Stage3 备菜 → 检查步骤中 `[食材(克重)]` 格式是否正确渲染

   * Stage4 分装 → 检查水量是否显示

   * Stage5 炒制 → 检查 `[碗N]` 和 `[食材(克重)]` 标签是否渲染
3. 进度条交互：

   * 在 Stage3 点击进度条上的"称量" → 应跳转 Stage2 只读

   * 在 Stage5 点击"备菜" → 应跳转 Stage3 只读

   * 点击未完成阶段 → 无反应
4. 只读模式浏览：从记录列表点"查看" → 进度条仍显示 → 可点击各阶段浏览
5. AI 返回验证：提交后检查 AI 返回的 prepSteps.description 是否包含 `[食材名(克重)]` 格式

***

## 假设与决策

1. **食材标签颜色**：8 种颜色循环分配，不考虑相邻食材颜色冲突（简单优先）
2. **进度条不显示在 Stage1（菜单）**：菜单确认页不需要进度条
3. **进度条在只读模式和编辑模式都显示**：方便任何状态下导航
4. **水量字段为可选**：不是所有碗都需要加水（如纯调料碗）
5. **兼容旧数据**：`ingredientTags` 为可选字段（`?`），旧 session 恢复时不崩溃，只是不显示标签颜色

