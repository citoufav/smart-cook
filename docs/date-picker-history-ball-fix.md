# 入库日期选择器 + 历史记录/悬浮球修复方案

## 概述

1. **入库日期**：用自定义弹窗选择器（年/月/日 ScrollView 三列），默认当前日期
2. **导入导出**：统一按钮样式
3. **历史记录查看备菜/炒制**：排查数据流，确保 AI 返回的 prepSteps/cookingSteps 正确保存并展示
4. **营养成分悬浮球**：排查显示/隐藏逻辑，确保菜单生成后球正常出现

---

## 当前状态分析

### 问题 1: 入库日期 TextInput ↔ 选择器
- 当前：`TextInput` 手动输入 YYYY-MM-DD
- 目标：点击弹出选择器 Modal，年/月/日三列滚动选择

### 问题 2: 导入导出样式
- 当前：`Ionicons` 箭头图标按钮
- 目标：与其他 UI 元素统一风格

### 问题 3: 历史记录备菜/炒制不可见
数据流追踪：
- AI prompt（[aiService.ts#L171-191](file:///e:/program/trae/SmartCook/SmartCook_demo/src/services/aiService.ts#L171)）包含 `prepSteps`、`cookingSteps`、`preciseNutrition`
- `handleStreamDone`（[cooking.tsx#L190-192](file:///e:/program/trae/SmartCook/SmartCook_demo/app/(tabs)/cooking.tsx#L190)）将 `result.prepSteps` 写入 `menuProposal`
- `menuHistoryService.add`（[cooking.tsx#L238-240](file:///e:/program/trae/SmartCook/SmartCook_demo/app/(tabs)/cooking.tsx#L238)）保存到历史
- 历史详情页（[history/[id].tsx#L51-52](file:///e:/program/trae/SmartCook/SmartCook_demo/app/history/[id].tsx#L51)）读取 `menu?.prepSteps`

可能原因：
- AI 未按 Schema 返回 prepSteps/cookingSteps（`response_format: json_object` 不强制所有字段）
- 旧历史记录无这些字段（预期行为）

### 问题 4: 悬浮球不显示
流程：
- [NutritionContext](file:///e:/program/trae/SmartCook/SmartCook_demo/src/contexts/NutritionContext.tsx) 初始 `isVisible: false`
- `handleStreamDone` 调用 `setEstimatedNutrition` → `SET_NUTRITION` → `isVisible: true`
- [FloatingBall](file:///e:/program/trae/SmartCook/SmartCook_demo/src/components/FloatingBall.tsx) 渲染在 `_layout.tsx` 根层级，条件 `!state.isVisible && scaleAnim._value === 0` 不渲染

可能原因：
- `hideBall()` 在 `useFocusEffect` 中每次 tab 聚焦执行，但导航到 pager 时不会触发
- 需要在 pager 进入时主动显示球

---

## 变更清单

### 文件 1: `app/(tabs)/index.tsx` — 日期选择器
- **删** `formDate` TextInput
- **增** 日期显示按钮（点击打开选择 Modal）+ 自定义 DatePickerModal 组件
- DatePickerModal 包含：
  - 年列表（当前年 ± 5）、月列表（1-12）、日列表（1-28/29/30/31 根据年月动态调整）
  - 三个并排 ScrollView，选中项高亮
  - "确定" / "取消" 按钮
  - 默认选中当前日期
- `handleEditIngredient` 中 `formDate` 改为从 `item.createDate` 解析

### 文件 2: `app/(tabs)/index.tsx` — 导入导出样式
- 导入导出按钮：保持图标样式，确保与页面其他元素风格一致

### 文件 3: `app/cooking/pager.tsx` — 悬浮球显示
- 在组件 mount 时检查是否有 session 且有营养数据，有则 `dispatch({ type: 'SHOW_BALL' })`
- 确保烹饪流程页面悬浮球正常出现

### 文件 4: `app/history/[id].tsx` — 备菜/炒制显示
- 增加日志打印 `prepSteps.length` 和 `cookingSteps.length` 以便调试
- 确认数据为空时显示 "暂无" 提示而非完全隐藏

### 文件 5: `src/services/aiService.ts` — Prompt 强化
- 在 JSON Schema 的 prepSteps/cookingSteps 字段备注中强调为必填
- 在 buildStage1UserPrompt 中添加 `"必须包含 prepSteps 和 cookingSteps 字段，不可省略"` 的要求

---

## 验证步骤
1. 添加食材 → 点击入库日期 → 弹出选择器 → 选择后日期正确回填 → 默认当前日期
2. 导入/导出图标正常显示，点击有效
3. 生成菜单 → 悬浮球出现在右下角，显示卡路里
4. 进入历史记录 → 点击查看 → 备菜步骤和炒制步骤卡片可见
