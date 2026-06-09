# 状态管理根本性修复计划

## 问题总览

经过完整代码追踪，发现 **5 个互相关联的 bug** 共同导致状态回退、进度条渲染错误、页面模式错乱。

---

## 一、Bug 清单

### Bug 1（严重）：`SET_CURRENT_STAGE` 无前向守卫 + 不更新 `completedStageIndex`

**文件**：[CookingContext.tsx](file:///e:/program/trae/做饭软件/SmartCook/src/contexts/CookingContext.tsx#L301-L307)

```typescript
case 'SET_CURRENT_STAGE': {
    if (!state.session) return state;
    return {
        ...state,
        session: { ...state.session, status: action.payload, updatedAt: now },
        // ❌ 无验证：接受任意 stage 值（可回退到 requirement）
        // ❌ 不更新 completedStageIndex → status 与 completedStageIndex 分歧
    };
}
```

**后果**：任何调用 `dispatch({ type: 'SET_CURRENT_STAGE', payload: 'weighing' })` 都能让状态回退。

### Bug 2（高）：`getStageIndex` 对非进度阶段返回 0

**文件**：[types/index.ts](file:///e:/program/trae/做饭软件/SmartCook/src/types/index.ts#L405-L407)

```typescript
export function getStageIndex(stage: CookingStage): number {
  return STAGE_INDEX_MAP[stage] ?? 0;  // ❌ 'completed'/'inventoryUpdate' 都返回 0
}
```

**后果**：进度条把 `'completed'` 当作 `'menu'(0)`，导致所有阶段被判定为 "done"，无 current 高亮。

### Bug 3（高）：Pager 的 `getMode` 忽略 `completedStageIndex`

**文件**：[CookingPager.tsx](file:///e:/program/trae/做饭软件/SmartCook/src/components/CookingPager.tsx#L116-L124)

```typescript
const getMode = (stageIndex: number) => {
    if (stageIndex < statusIndex) return 'readonly';   // ❌ 只用 statusIndex
    if (stageIndex === statusIndex) return 'interactive';
    return 'locked';
};
```

**后果**：页面模式与全局进度脱钩。如果 status 变了但 completedStageIndex 没变，中间阶段会被错误标为 readonly。

### Bug 4（高）：进度条 `currentStage` 传了不兼容的值

**文件**：[CookingPager.tsx](file:///e:/program/trae/做饭软件/SmartCook/src/components/CookingPager.tsx#L172-L177)

```typescript
<CookingProgressBar
    currentStage={session.status}  // ❌ 可能是 'completed'/'inventoryUpdate'，不在 PROGRESS_STAGES 中
    completedStages={...}
/>
```

**后果**：历史记录模式下 `session.status` 可能是 `'completed'`，进度条找不到对应节点，全部显示 dark。

### Bug 5（高）：迁移函数 `.every()` 对空数组返回 true

**文件**：[CookingContext.tsx](file:///e:/program/trae/做饭软件/SmartCook/src/contexts/CookingContext.tsx#L53-L54)

```typescript
if (stages.generatedPlan?.bowlAssignments?.every((b) => b.isCompleted)) idx = Math.max(idx, 2);
// ❌ bowlAssignments=[] 时 .every() 返回 true → completedStageIndex 被错误设为 2
```

---

## 二、修复方案

### 修复 1：`SET_CURRENT_STAGE` 加固

**文件**：`src/contexts/CookingContext.tsx`

```typescript
case 'SET_CURRENT_STAGE': {
    if (!state.session) return state;
    const targetIndex = getStageIndex(action.payload);
    // 拒绝非进度阶段
    if (targetIndex < 0 || targetIndex >= STAGE_KEYS.length) return state;
    const currentCompleted = state.session.completedStageIndex;
    // 前向守卫：不允许回退到已完成阶段
    if (targetIndex <= currentCompleted) return state;
    return {
      ...state,
      session: {
        ...state.session,
        status: action.payload,
        completedStageIndex: Math.max(currentCompleted, targetIndex - 1),
        updatedAt: now,
      },
    };
}
```

### 修复 2：`getStageIndex` 对非进度阶段返回 -1

**文件**：`src/types/index.ts`

```typescript
export function getStageIndex(stage: CookingStage): number {
  if (!(stage in STAGE_INDEX_MAP)) return -1;  // 非进度阶段返回 -1
  return STAGE_INDEX_MAP[stage];
}
```

### 修复 3：Pager 的 `getMode` 使用 `completedStageIndex`

**文件**：`src/components/CookingPager.tsx`

```typescript
const getMode = (stageIndex: number) => {
    if (historyMode) {
      return stageIndex <= session.completedStageIndex ? 'readonly' : 'locked';
    }
    // effectiveIndex = 当前应该操作的阶段
    const effectiveIndex = Math.max(statusIndex, session.completedStageIndex + 1);
    if (stageIndex < effectiveIndex) return 'readonly';
    if (stageIndex === effectiveIndex) return 'interactive';
    return 'locked';
};
```

### 修复 4：进度条 `currentStage` 用进度阶段

**文件**：`src/components/CookingPager.tsx`

```typescript
<CookingProgressBar
    currentStage={STAGE_KEYS[Math.max(0, session.completedStageIndex)] || session.status}
    completedStages={STAGE_KEYS.slice(0, Math.max(0, session.completedStageIndex + 1))}
    readonly={historyMode}
    onStagePress={handleProgressBarPress}
/>
```

### 修复 5：迁移函数空数组修复

**文件**：`src/contexts/CookingContext.tsx`

```typescript
// 替换 .every() 为空数组安全版本
const bowlAssignments = stages.generatedPlan?.bowlAssignments;
if (bowlAssignments && bowlAssignments.length > 0 && bowlAssignments.every((b) => b.isCompleted)) {
    idx = Math.max(idx, 2);
}
const cookingSteps = stages.generatedPlan?.cookingSteps;
if (cookingSteps && cookingSteps.length > 0 && cookingSteps.every((s) => s.isCompleted)) {
    idx = Math.max(idx, 3);  // 注意：cooking 是索引 4，但 idx 表示"已完成到哪个"
}
// 修复 cooking 索引：应该是 4 不是 3
// cookingSteps 全部完成 → idx = 4
```

等一等——检查 `STAGE_KEYS`：menu=0, weighing=1, prep=2, bowl=3, cooking=4。所以 bowl 完成 → idx=3，cooking 完成 → idx=4。当前代码 line 55 的 `idx = Math.max(idx, 3)` 应该是 4。

### 修复 6（附带）：`ensureCompletedStageIndex` cooking 索引修正

同上，`cookingSteps` 全部完成时 `idx` 应该设为 4 而不是 3。

---

## 三、文件变更汇总

| 文件 | 修复项 | 说明 |
|------|--------|------|
| `src/contexts/CookingContext.tsx` | Bug 1, 5, 6 | `SET_CURRENT_STAGE` 前向守卫 + 更新 completedStageIndex；迁移函数空数组修复 + cooking 索引修正 |
| `src/types/index.ts` | Bug 2 | `getStageIndex` 非进度阶段返回 -1 |
| `src/components/CookingPager.tsx` | Bug 3, 4 | `getMode` 用 effectiveIndex；progress bar `currentStage` 用 STAGE_KEYS |

---

## 四、进度条渲染效果（修复后）

| 阶段 | 正常模式 | 历史模式 |
|------|---------|---------|
| `< completedStageIndex` | done（暗色，可点击） | done（暗色，可点击） |
| `== completedStageIndex+1` | current（亮色，大圆点） | × 不存在 |
| `> completedStageIndex+1` | future（灰色，不可点击） | locked（灰色，不可点击） |
| 全部完成（`status='completed'`） | currentStage=最后一个进度阶段 | 所有节点 done（暗色） |

---

## 五、验证步骤

1. `npx tsc --noEmit` — 无新增 TS 错误
2. 正常流程：菜单 → 称量 → 备菜 → 分装 → 制作 → 库存更新 — 状态只前进不回退
3. 在 stage5 点进度条回看 stage2 → 状态仍为 cooking，点不改变
4. 完成 stage4 bowl → 自动滑到 cooking，progress bar cooking 亮色大圆点
5. 历史记录查看 → 进度条正确显示已完成/未完成
