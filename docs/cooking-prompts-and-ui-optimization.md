# 烹饪步骤提示词优化 & UI 修复 & 营养弹窗时机调整

## 一、当前状态分析

### 1. 提示词系统

* **系统提示词**：`aiService.ts` 中 `SYSTEM_PROMPT_CN`（第44-63行），全局共享

* **Stage1 用户提示词**：`buildStage1UserPrompt`（第65-133行），生成菜单

* **Stage2 用户提示词**：`buildStage2UserPrompt`（第321-399行），生成备菜/分装/炒制方案

当前问题：

* `SYSTEM_PROMPT_CN` 未明确说明主食（米饭、馒头、面条）也是一道菜

* 缺少具体示例，AI 需要"猜测"输出格式

* "相同切配方式合并"逻辑靠隐式理解，缺乏明确指令

* cookingSteps 详细程度要求模糊（如煮米饭加水量）

* 所有提示词缺少反例（禁止做的事）

### 2. Stage3 备菜（stage3-prep.tsx）

* Checkbox 的 `label` 是纯文本拼接 `ingredientName + quantity + description`（第133行）

* 另有一行 `tagRow` 渲染 `IngredientTagText`（第135-139行）

* **结果**：每条备菜显示两行 —— 纯文字版 + 标签版，重复冗余

### 3. Stage4 分装（stage4-bowl.tsx）

* 每个碗下方显示 `💧 需加水：{item.waterAmount}`（第107-108行）

* 用户意图：让 AI 在炒制步骤中写清楚水量（如"加清水300g"），而不是在每个碗独立显示

### 4. Stage5 炒制（stage5-cooking.tsx）

* 同样问题：Checkbox label 显示纯文本 `step.instruction`，tagRow 显示标签版

* 导致每条炒制步骤也显示两版

* 碗标签 `[碗N]` 和食材标签样式风格不统一

### 5. 营养弹窗时机

* 菜单确认时（`cooking.tsx` `handleStreamDone`）：调用 `setEstimatedNutrition` → 弹营养球 ✓

* 称量完成时（`stage2-weighing.tsx` `onSuccess`）：调用 `setPreciseNutrition` → 立即弹 → 跳转 stage3

* 炒制完成时（`stage5-cooking.tsx` `handleDone`）：调用 `openSheet()` → 3 秒后跳 inventory-update

问题：用户要求精确营养在"备菜开始时弹"（即进入 stage3 时），而非称量完成时立即弹。且不应在最后更新库存时弹窗。

### 6. 标签样式

* 食材标签 `[食材名(克重)]`：`tagColor + '22'` 半透明背景 + 彩色文字，`borderRadius: 4`

* 碗标签 `[碗N]`：`primaryLight + '33'` 半透明背景 + `primaryDark` 文字

* 风格不统一，视觉不够清晰直观

***

## 二、修改方案

### 2.1 提示词全面优化（`src/services/aiService.ts`）

#### 2.1.1 重写 `SYSTEM_PROMPT_CN`

**改动内容**：

* 新增规则：明确主食（米饭/馒头/面条等）也是一道独立菜品

* 新增规则：相同食材相同切配方式的备菜步骤必须合并（如小葱切葱花用于多道菜 → 一个备菜步骤，分装时再分配）

* 新增规则：炒制步骤需写明确切数字，如"加入清水300g"，不允许比例表述

* 每条规则增加具体示例

* 增加反例（禁止事项）

#### 2.1.2 重写 `buildStage2UserPrompt`

**改动内容**：

* 增加「备菜合并」明确指令：“如果同一食材在多道菜中切配方式完全相同（如都是切葱花、都是切片），请合并为一个备菜步骤...”

* 增加合并备菜的 JSON 示例（输入 + 期望输出）

* 增加分装阶段分开的示例

* 增加 stir-fry 水量详细示例

* 在 JSON Schema 后增加完整示例片段

***

### 2.2 扩展 Checkbox 组件（`src/components/Checkbox.tsx`）

**改动**：

* `CheckboxProps` 新增 `labelContent?: React.ReactNode` 属性

* 渲染逻辑：如果 `labelContent` 存在，渲染 `<View>{labelContent}</View>`；否则回退到现有 `<Text>{label}</Text>`

* 添加 `labelContent` 样式（flex: 1, marginLeft 保持一致）

***

### 2.3 修复 Stage3 备菜双版本（`app/cooking/stage3-prep.tsx`）

**改动**：

* Checkbox 不再使用 `label` 属性，改用 `labelContent` 传入 `IngredientTagText` 渲染的标签版本

* 删除独立的 `tagRow` 及 `IngredientTagText` 调用

* Checkbox 的 labelContent =

  ```
  <Text>
    {step.ingredientName ? <Text style={bold}>{step.ingredientName} </Text> : null}
    {step.quantity ? <Text>{step.quantity} </Text> : null}
    <IngredientTagText text={step.description} ingredientTags={ingredientTags} />
  </Text>
  ```

  这样就实现了"食材名 + 用量 + 描述（含标签）"一行显示，没有重复

***

### 2.4 修复 Stage4 分装去水显示（`app/cooking/stage4-bowl.tsx`）

**改动**：

* 删除 `{item.waterAmount && <Text style={styles.waterText}>...` 整块代码

* 删除 `styles.waterText` 样式

* 同时从 AI 提示词中删除 `waterAmount` 字段的要求，改为要求在 cookingSteps 中写详细

***

### 2.5 修复 Stage5 炒制双版本 + 标签统一样式（`app/cooking/stage5-cooking.tsx`）

**改动**：

* Checkbox 改用 `labelContent` 传入 `InstructionText` 渲染的标签版本

* 删除独立的 `tagRow` 及 `InstructionText` 调用

* 统一碗标签和食材标签样式设计：

  * **碗标签**：白底 + 主题色边框 + 主题色文字（`borderWidth: 1.5, borderColor: primary, color: primary, backgroundColor: '#FFF'`）

  * **食材标签**：彩色底 + 白色/深色文字（保持现有8色循环，但用实色背景 + 白色文字或深色文字）

  * 两种标签统一 `borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2`

* 重新设计 `InstructionText` 组件内的两种标签样式

***

### 2.6 营养弹窗时机调整

#### 2.6.1 cooking.tsx（不做改动）

保持现有 `setEstimatedNutrition` 调用 —— 菜单确认后弹第一次（预估值），已正确。

#### 2.6.2 stage2-weighing.tsx

* 从 `onSuccess` 中**删除** `setPreciseNutrition(...)` 调用

* 保留 `preciseNutrition` 数据写入 `generatedPlan`（已经通过 `setStage2Result` + `cookingProgressService.save` 持久化）

#### 2.6.3 stage3-prep.tsx（新增逻辑）

* 在组件 mount（`useFocusEffect` + ref 标记首次）时读取 `generatedPlan?.preciseNutrition`

* 构建 `nutritionByDish` 映射并调用 `setPreciseNutrition`

* 仅在非只读模式且首次进入时执行一次

#### 2.6.4 stage5-cooking.tsx

* `handleDone` 中删除 `openSheet()` 调用

* 删除 `setTimeout(() => { router.push('/cooking/inventory-update'); }, 3000)` 中的 setTimeout

* 直接导航：`router.push('/cooking/inventory-update')`

* 删除 `useNutrition` 的 `openSheet` 引用（如无其他使用则删除整个 import）

***

### 2.7 类型清理（`src/types/index.ts`）

**改动**：

* `BowlAssignment` 中删除 `waterAmount?: string` 字段

* `Stage2AIResponse` 中删除 `waterAmount` 相关（它不在该类型中，不需要改）

注：如果 `BowlAssignment` 的 `waterAmount` 在库存更新等地方有引用，需要一并清理（经搜索，仅在 stage4-bowl 渲染中使用）。

***

### 2.8 标签样式设计规范

#### 食材标签 `[大米(200g)]`

```ts
{
  backgroundColor: tagColor,         // 8色循环中的颜色
  color: '#FFFFFF',                  // 白色文字
  fontWeight: '600',
  borderRadius: 6,
  paddingHorizontal: 6,
  paddingVertical: 2,
  overflow: 'hidden',
  fontSize: 13,
}
```

#### 碗标签 `[碗1]`

```ts
{
  backgroundColor: '#FFFFFF',
  borderWidth: 1.5,
  borderColor: COLORS.primary,
  color: COLORS.primary,
  fontWeight: '700',
  borderRadius: 6,
  paddingHorizontal: 6,
  paddingVertical: 2,
  overflow: 'hidden',
  fontSize: 13,
}
```

***

## 三、涉及文件清单

| 文件                               | 操作 | 说明                                            |
| -------------------------------- | -- | --------------------------------------------- |
| `src/services/aiService.ts`      | 修改 | 重写 SYSTEM\_PROMPT\_CN 和 buildStage2UserPrompt |
| `src/components/Checkbox.tsx`    | 修改 | 新增 labelContent 属性                            |
| `app/cooking/stage3-prep.tsx`    | 修改 | 修复双版本 + 营养弹窗 + 标签样式                           |
| `app/cooking/stage4-bowl.tsx`    | 修改 | 删除水显示                                         |
| `app/cooking/stage5-cooking.tsx` | 修改 | 修复双版本 + 标签样式 + 删除 openSheet                   |
| `stage2-weighing.tsx`            | 修改 | 删除 setPreciseNutrition 调用                     |
| `src/types/index.ts`             | 修改 | 删除 BowlAssignment.waterAmount                 |

***

## 四、验证步骤

1. `npx tsc --noEmit` 确保无 TypeScript 错误
2. 在 Expo Go 中验证：

   * 菜单确认后营养悬浮球弹出（预估值）

   * 称量完成 → AI 生成方案（提示词应按新规则输出）

   * 进入备菜阶段 → 营养悬浮球更新为精确值

   * 备菜步骤只显示标签版（无纯文字重复）

   * 分装阶段不再显示"需加水：xxx"

   * 炒制步骤只显示标签版（无纯文字重复）

   * 食材标签和碗标签样式统一美观

   * 炒制完成后点击"更新库存"直接跳转，不弹营养窗

