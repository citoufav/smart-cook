# 4个Bug修复计划

## 分析摘要

通过日志分析和代码审查，4个问题根因已全部定位。

---

## Bug 1: 菜谱页营养总和显示全0

**根因**: AI prompt 已移除根级 `estimatedNutrition`（上一轮改动），但 `app/(tabs)/cooking.tsx` 第166行仍在读取 `result.estimatedNutrition`，取不到就 fallback 为全零 `{ calories: 0, ... }`。per-dish 营养正常（来自 `dish.estimatedNutrition`），只有总营养卡片显示0。

**修复**: `cooking.tsx` 中 `menuProposal.estimatedNutrition` 改为程序端从 per-dish 数据求和，不再依赖 AI 输出。在 `handleStreamDone` 中基于已有 `nutritionByDish` 计算总营养。

**涉及文件**: `app/(tabs)/cooking.tsx`

---

## Bug 2: 炒制阶段标签损坏

**根因**: `stage5-cooking.tsx` 第26行正则 `/\[(.+?\(\d+)g(?!\)\])/g` 中 `.+?` 会跨越 `]` 边界匹配，把 `[碗3]中肉臊子部分(100g)` 误匹配为 `[碗3]中肉臊子部分(100g`，替换后变成 `[碗3]中肉臊子部分(100g]`。

同一正则也存在于 `stage3-prep.tsx`。

**修复**: 将 `.+?` 改为 `[^\]]+`（不跨越 `]`），只匹配单个 `[...]` 对内的内容。

**涉及文件**: 
- `app/cooking/stage5-cooking.tsx`
- `app/cooking/stage3-prep.tsx`

---

## Bug 3: 全部完成后营养面板弹出且关不掉

**根因**: 两个问题叠加：
1. `inventory-update.tsx` 执行 `dispatch({ type: 'SET_CURRENT_STAGE', payload: 'completed' })`，但 `CookingContext` 中 `completed` 不在 `STAGE_KEYS` 内，`getStageIndex` 返回 -1，dispatch 被静默忽略。营养状态未清理。
2. 虽然 `(tabs)/cooking.tsx` 的 `useFocusEffect` 调用了 `hideBall()`，但营养数据仍留在 Context 中，悬浮球和面板可能会在某些时机重新出现。

用户的反馈是"把强制弹出功能删了"——即不要在完成后自动弹出营养成分表。

**修复**:
- `inventory-update.tsx` 返回主页面前调用 `reset()` 彻底清空 NutritionContext（而不是依赖 `hideBall`）
- 同时修复 `SET_CURRENT_STAGE` 对 `completed` 的处理，允许 `completedStageIndex` 继续递增

**涉及文件**:
- `app/cooking/inventory-update.tsx`
- `src/contexts/CookingContext.tsx`

---

## Bug 4: 历史记录按钮 + 进度条

### 4a. "继续"和"查看"同时出现

**根因**: `app/(tabs)/cooking.tsx` 第502-524行无条件渲染三个按钮，没有根据记录状态做条件判断。

**修复**: 
- 记录已全部完成（`currentStage === 'completed'` 或 `completedStageIndex >= 4`）→ 只显示"查看"和"删除"
- 记录进行中 → 只显示"继续"和"删除"
- 新增按钮逻辑：`const isCompleted = record.currentStage === 'completed' || record.completedStageIndex >= 4;`

### 4b. 历史模式进度条异常

**根因**: `CookingPager.tsx` 的 `effectiveIndex` 对非 `STAGE_KEYS` 阶段（如 `inventoryUpdate`、`completed`）返回 -1，导致不渲染任何阶段内容。

**修复**:
- `effectiveIndex` 在 historyMode 下遇到非 STAGE_KEYS 值时，回退到 `session.completedStageIndex`（最后一个可查看阶段）
- `CookingProgressBar` 的 `currentStage` 同样处理，确保进度条高亮正确

**涉及文件**:
- `app/(tabs)/cooking.tsx`
- `src/components/CookingPager.tsx`

---

## 涉及文件清单

| 文件 | 修复内容 |
|------|---------|
| `app/(tabs)/cooking.tsx` | Bug1: 总营养从per-dish求和；Bug4a: 按钮条件渲染 |
| `app/cooking/stage5-cooking.tsx` | Bug2: 正则修复 |
| `app/cooking/stage3-prep.tsx` | Bug2: 正则修复 |
| `app/cooking/inventory-update.tsx` | Bug3: 返回首页时reset NutritionContext |
| `src/contexts/CookingContext.tsx` | Bug3: SET_CURRENT_STAGE处理completed |
| `src/components/CookingPager.tsx` | Bug4b: historyMode effectiveIndex回退 |

---

## 实现顺序

1. Bug2（正则） — 最小改动，先修
2. Bug4a + Bug4b（历史记录） — 按钮条件 + pager修复
3. Bug1（营养总和） — 程序端求总营养
4. Bug3（强制弹出） — reset + completed处理

## 验证步骤

1. `npx tsc --noEmit` 无新增错误
2. 菜谱页总营养卡片不再显示全0
3. 炒制阶段标签不再出现 `(100g])` 等损坏
4. 完成做菜后回到主页，营养悬浮球和面板不自动弹出
5. 历史记录：已完成的只显示"查看"，进行中的只显示"继续"
6. 历史记录：点击查看能正常显示对应阶段内容
