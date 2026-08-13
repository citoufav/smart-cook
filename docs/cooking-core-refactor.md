# 做菜流程核心重构方案

## 架构评估结论

经过全面代码审查和日志分析，**当前架构设计是成熟的**（FSM状态机 + Context/useReducer + 三态模式），不需要推倒重来。问题集中在 **2个文件约100行代码** 的计算逻辑错误，而非架构缺陷。

| 模块 | 评估 | 状态 |
|------|------|------|
| CookingContext reducer (21 action types) | FSM状态机设计合理 | 保持 |
| 五个阶段 Screen/Content 双导出模式 | 成熟的分层模式 | 保持 |
| cookingProgressService | 版本化Key + LRU淘汰 | 保持 |
| `getStageMode` / `StageMode` 三态模型 | 锁定/只读/交互 清晰 | 保持 |
| **CookingPager.tsx effectiveIndex 计算** | 逻辑错误（3处） | **重写** |
| **SET_CURRENT_STAGE reducer** | 缺少向后导航的proper支持 | **修复** |
| **Content.onComplete → handleStageComplete 二次推进** | COMPLETE_ALL_* 已推进status，onComplete又推进一次 | **修复** |

---

## 根因分析

### 问题1: 查看模式点击导航栏不切换页面

**日志证据** (行12-43): dispatch 确实执行了，`session.status` 确实变了，但页面内容没变。

**根因**: `CookingPager.tsx` 第59-61行，historyMode下 `effectiveIndex` 被 `initialStage` URL参数锁定：

```ts
effectiveIndex = initialStage
  ? Math.max(0, getStageIndex(initialStage))  // ← 永远不变
  : Math.max(0, fallbackIndex)
```

`initialStage` 是在 `app/cooking/pager.tsx` 中通过 `useLocalSearchParams()` 获取的，组件生命周期内不变。所以无论进度条dispatch多少次，`effectiveIndex` 始终指向入参阶段。

### 问题2: 制作过程点击之前步骤发生步骤回退

**日志证据** (行140-155): 用户点 prep → dispatch 成功 → 但 effectiveIndex 不变（仍渲染 bowl）→ bowl 的 onComplete 触发 handleStageComplete → 读取 session.status='prep' → 又推进到 bowl → 级联推进到 cooking → inventoryUpdate

**根因链**:
1. `effectiveIndex = Math.max(statusIndex, completedStageIndex + 1)` — 永远取最大值，用户无法向后导航渲染
2. Content 的 `onComplete` 回调在 `mode='interactive'` 时激活
3. `handleStageComplete` 用 `session.status` 作为源（已改为prep），但页面渲染的是bowl
4. 页面和状态的断层导致 `handleStageComplete` 错误地把状态往前推进

### 问题3: Content.onComplete 与 COMPLETE_ALL_* 二次推进

**根因**: Content 组件先 dispatch `COMPLETE_ALL_PREP`（status 从 prep→bowl，completedStageIndex=2），再调用 `onComplete?.()`。Pager 的 `handleStageComplete` 读到已更新的 status='bowl'（idx=3），试图推进到 idx=4='cooking'——跳过了 bowl 阶段。

Screen 模式不受影响，因为 Screen 用 `router.push()` 直接导航，不调用 `onComplete`。

### 问题4: 营养成分显示"米饭580，烩菜750，总计360"

**日志证据** (行93-97): 精确营养求和=1800卡，人均=1800/5=360卡。**计算正确**。

4个菜品的 nutritionDishes 数据中，米饭580卡、烩菜750卡等是per-dish总营养。总计tab显示的是人均（per-person）360卡。用户期望看到总营养1800卡而非人均。

**根因**: 之前为了"总计"tab显示人均而做的改动（`getPerPersonNutrition`），在总计tab和悬浮球显示人均合理，但在用户对比各菜品数字时会困惑。

### 问题5: 回退后导航栏和当前页面不同步

**根因**: 问题2的直接后果。`session.status` 被进度条改为 prep，但 `effectiveIndex` 仍渲染 bowl。进度条从 `session.status` 读取当前位置（prep），页面从 `effectiveIndex` 渲染（bowl）——二者不一致。

---

## 重构方案

### 核心原则

1. **effectiveIndex 的唯一数据源**: `session.status`（仅当 status 为 STAGE_KEYS 成员时生效）
2. **historyMode 下不用 initialStage 锁定页面**: 用 `session.status` 驱动渲染，`initialStage` 仅用于初始定位
3. **onComplete 只通知不推进**: Content 调用 `onComplete?.()` 只是告知Pager"我完成了"，由Pager自己判断是否推进
4. **营养成分总计tab可切换**: 支持查看"总营养"和"人均营养"

### 改动清单

#### 1. CookingPager.tsx — 重写 effectiveIndex 和 handleStageComplete

**当前代码** (第53-103行):
```
statusIndex = getStageIndex(session.status)
fallbackIndex = historyMode ? (statusIndex<0 ? completedStageIndex : statusIndex) : statusIndex
effectiveIndex = historyMode
  ? (initialStage ? Math.max(0, getStageIndex(initialStage)) : Math.max(0, fallbackIndex))
  : Math.max(statusIndex, completedStageIndex + 1)
```

**重写为**:
```tsx
// statusIndex → 当前 session.status 对应的 STAGE_KEYS 索引（非成员返回 -1）
const statusIndex = getStageIndex(session.status);

// 要渲染的阶段索引（唯一数据源：session.status）
const effectiveIndex = useMemo(() => {
  // 非 STAGE_KEYS 成员（requirement/inventoryUpdate/completed/cancelled）
  if (statusIndex < 0) {
    if (historyMode) {
      // 历史模式：回退到最后一个完成阶段
      return Math.max(0, session.completedStageIndex);
    }
    return -1; // 正常模式：不应该出现
  }
  // 正常渲染 status 指向的阶段
  return statusIndex;
}, [session.status, session.completedStageIndex, historyMode]);

// 进度条可访问范围
const maxAccessibleStage = historyMode
  ? session.completedStageIndex
  : Math.max(statusIndex, session.completedStageIndex + 1);
```

**重写 handleStageComplete**:
```tsx
const handleStageComplete = useCallback(() => {
  const currentIdx = getStageIndex(session.status);
  if (currentIdx < 0) {
    if (session) cookingProgressService.save(session).catch(() => {});
    return;
  }
  const nextIdx = currentIdx + 1;
  if (nextIdx >= STAGE_KEYS.length) {
    router.push('/cooking/inventory-update');
    return;
  }
  // 仅当当前是 STAGE_KEYS 的正常阶段、且 nextIdx 不超过已完成的+1时才推进
  // 避免 COMPLETE_ALL_* 已经推进后再次推进
  const targetStatus = STAGE_KEYS[nextIdx];
  if (session.status === targetStatus) return; // 已经在此阶段，不重复推进
  dispatch({ type: 'SET_CURRENT_STAGE', payload: targetStatus });
}, [session, dispatch]);
```

**重写 getMode** (移除 `eff` 中间变量):
```tsx
const getMode = (stageIndex: number) => {
  if (historyMode) {
    return stageIndex <= session.completedStageIndex ? 'readonly' : 'locked';
  }
  // 正常模式：completedStageIndex 之前的阶段只读
  if (stageIndex <= session.completedStageIndex) return 'readonly';
  // 当前 effectiveIndex 对应阶段可交互
  if (stageIndex === effectiveIndex) return 'interactive';
  // 未来阶段锁定
  return 'locked';
};
```

**初始化处理**: 在 historyMode 时，如果组件首次挂载且 status 不在 STAGE_KEYS 中，用 initialStage 设置初始状态：
```tsx
// 历史模式首次进入时定位到 initialStage
useEffect(() => {
  if (historyMode && initialStage && statusIndex < 0) {
    const targetIdx = getStageIndex(initialStage as any);
    if (targetIdx >= 0 && targetIdx <= session.completedStageIndex) {
      dispatch({ type: 'SET_CURRENT_STAGE', payload: initialStage as any });
    }
  }
}, []);
```

#### 2. CookingContext.tsx — SET_CURRENT_STAGE 改进

**当前逻辑**: `completedStageIndex = Math.max(currentCompleted, targetIndex - 1)`

保持此逻辑不变，但**不再需要之前删除的"禁止回退"守卫**。因为：
- 进度条上的 `maxAccessible` 已经在组件层做了访问控制
- reducer 纯粹记录状态变更，不判断方向

**SET_CURRENT_STAGE 对 'completed' 的处理**（已有，正确）:
```ts
if (action.payload === 'completed') {
  return {
    ...state,
    session: {
      ...state.session,
      status: STAGE_KEYS[STAGE_KEYS.length - 1], // 'cooking'
      completedStageIndex: STAGE_KEYS.length - 1,  // 4
      updatedAt: now,
    },
  };
}
```

#### 3. Content 组件的 onComplete 处理（无需改动）

Content 组件的 `handleComplete` 模式是正确的：dispatch `COMPLETE_ALL_*`（原子完成+推进） → 调用 `onComplete?.()`。Pager 的 `handleStageComplete` 新逻辑会检测到 status 已是目标阶段而跳过重复推进。

只需确认各 Content 在调用 `onComplete` 时使用正确的 `mode` 判断（如 `mode === 'interactive'`）。

#### 4. 营养成分总计Tab — 切换人均/总营养

**当前**: NutritionBottomSheet "总计" tab 始终显示人均（`getPerPersonNutrition`）

**修复**: 总计tab默认显示人均，点击可切换为总营养。简化实现：总计tab行增加一个切换指示器，存储local state `showTotal`。

实际最简单的修复：总计tab同时显示"总营养"和"人均"，避免困惑：
```
总计 (5人份)
━━━━━━━━━━━━
热量  1800 卡
蛋白质  48 g
脂肪  62.5 g
碳水  260 g
━━━━━━━━━━━━
人均 (÷5)
热量  360 卡
蛋白质  10 g
脂肪  13 g
碳水  52 g
```

#### 5. Stage5 标签问题

normalizeBrackets 已在上一次修复中删除。如果仍有标签问题，检查 AI prompt 和标签解析正则。

---

## 涉及文件

| 文件 | 改动类型 | 改动量 |
|------|---------|--------|
| `src/components/CookingPager.tsx` | **重写** effectiveIndex / handleStageComplete / getMode | ~50行 |
| `src/contexts/CookingContext.tsx` | 日志清理（可选） | ~5行 |
| `src/components/NutritionBottomSheet.tsx` | 总计tab显示总营养+人均 | ~20行 |
| `app/cooking/inventory-update.tsx` | 已在上次修复（await save） | 已完成 |

---

## 验证步骤

1. **查看模式页面切换**: 进入历史记录→查看→点击进度条各阶段→确认页面内容随之切换
2. **正常模式回退**: 做菜到阶段3→点击进度条回到阶段2→确认显示阶段2只读内容，不自动跳回3
3. **正常模式推进**: 完成阶段2→确认自动推进到阶段3（不跳过阶段）
4. **完成全部流程**: 确认历史记录显示"查看"而非"继续"
5. **营养成分**: 总计tab确认同时显示总营养和人均，数字与各菜tab能对上
6. **进度条同步**: 进度条高亮与当前页面一致
7. `npx tsc --noEmit` 无新增错误
