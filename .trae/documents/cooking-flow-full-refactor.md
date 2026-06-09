# SmartCook 做饭流程彻底重构计划

## 一、核心问题

当前有**两套导航系统同时存活**，互相冲突：

| 问题 | 直接原因 | 根因 |
|------|----------|------|
| 部分界面没进度条 | 按钮触发 `router.push` 进入旧独立路由页面（进度条已移除） | `Stage1MenuContent`、`Stage2WeighingContent` 内部调用 `router.push/replace` 离开 Pager |
| "继续做菜"后按钮消失 | 从记录恢复时 `completedStageIndex` 与实际进度不一致，`getMode` 返回 `readonly` | `useStageMode` 和 `CookingPager.getMode` 公式不同；`ensureCompletedStageIndex` 可能设置过大值 |
| 进度条连接线错误 | `currentStage` 使用 `completedStageIndex` 对应 key 而非 `session.status` | CookingPager.tsx:188 |
| 代码重复 80%+ | Default 导出和 Content 导出几乎一样 | 历史遗留 |

## 二、重构目标

**单一 Pager 架构**：5 个阶段组件只负责渲染，所有导航由 `CookingPager` 统一通过 `scrollTo` 控制。/ 不引入新的复杂度 / 不增加文件数量。

## 三、方案：最小改动修复（非大拆大建）

不提取新文件，直接在现有文件上做精准手术，解决 6 个具体 bug。

### 3.1 修复 Stage1MenuContent — 加 onComplete，删 router.push

**文件**：`app/cooking/stage1-menu.tsx`

**改法**：
1. `Stage1MenuContentProps` 接口加 `onComplete?: () => void`
2. "确认菜单"按钮的 `onPress` 改为：`setCurrentStage('weighing')` + `onComplete?.()`，**删除** `router.push('/cooking/stage2-weighing')`

### 3.2 修复 Stage2WeighingContent — 删 router.replace

**文件**：`app/cooking/stage2-weighing.tsx`

**改法**：在 `onSuccess` 回调（约第 739 行），**删除** `router.replace('/cooking/stage3-prep')` 这一行。`onComplete?.()` 已在上一行。

### 3.3 修复 CookingPager 进度条 currentStage

**文件**：`src/components/CookingPager.tsx`

**改法**（第 188 行）：
```typescript
// 改前
currentStage={STAGE_KEYS[session.completedStageIndex] || session.status}
// 改后
currentStage={session.status}
```

### 3.4 删除 CookingProgressBar 独立路由模式

**文件**：`src/components/CookingProgressBar.tsx`

**改法**：
1. 删除 `import { router }` 
2. `handleStagePress` 中，删除 `if (onStagePress) { ... return; }` 后面的 `router.push(...)` 整段（第 53-61 行），改为 `if (!onStagePress) return;`

### 3.5 统一 mode 计算 — useStageMode 加 +1

**文件**：`src/contexts/CookingContext.tsx`

**改法**（第 443 行）：
```typescript
// 改前
return getStageMode(stageIndex, Math.max(currentIndex, state.session.completedStageIndex));
// 改后（和 CookingPager.getMode 对齐）
return getStageMode(stageIndex, Math.max(currentIndex, state.session.completedStageIndex + 1));
```

### 3.6 修复 CookingPager Stage0 传 onComplete

**文件**：`src/components/CookingPager.tsx`

**改法**（第 153 行）：
```typescript
// 改前
return <Stage1MenuContent {...commonProps} />;
// 改后
return <Stage1MenuContent {...commonProps} onComplete={handleStageComplete} />;
```

### 3.7 修复 ensureCompletedStageIndex 上限

**文件**：`src/contexts/CookingContext.tsx`

**改法**：在函数末尾，推导出的 `idx` 如果大于 `statusIdx`，则回退到 `statusIdx`（当前阶段不应被标记为已完成）：
```typescript
// 在现有兜底逻辑之后加
if (idx > statusIdx && statusIdx >= 0) {
  idx = statusIdx;
}
```

### 3.8 修复 Stage4BowlContent 只读模式不显示 isCompleted

**文件**：`app/cooking/stage4-bowl.tsx`

**问题**：`Stage4BowlContent` 的只读模式用 `checkStates`（空对象），不用 `item.isCompleted`，导致已完成项显示为未勾选。

**改法**：和 `Stage3PrepContent` 一致 — 读模式下用 `item.isCompleted ?? false`。

## 四、修改文件清单

| # | 文件 | 改什么 |
|---|------|--------|
| 1 | `app/cooking/stage1-menu.tsx` | `Stage1MenuContentProps` 加 `onComplete`；按钮删 `router.push`，用 `onComplete` |
| 2 | `app/cooking/stage2-weighing.tsx` | 删 `router.replace('/cooking/stage3-prep')` |
| 3 | `app/cooking/stage4-bowl.tsx` | `Stage4BowlContent` 只读模式用 `item.isCompleted` |
| 4 | `src/components/CookingPager.tsx` | `currentStage` 改为 `session.status`；Stage0 传 `onComplete` |
| 5 | `src/components/CookingProgressBar.tsx` | 删 `router` import；删独立路由 `router.push` 代码 |
| 6 | `src/contexts/CookingContext.tsx` | `useStageMode` 加 `+1`；`ensureCompletedStageIndex` 防止超限 |

## 五、不改什么

- **不删除** 5 个旧 stage 文件（保留向后兼容，但不再有新代码走旧路由）
- **不提取**新文件（所有改动在现有 6 个文件中完成）
- Default 导出保留不动（它们不会再被新流程调用）
- `_layout.tsx` 不动（已只剩 3 个路由）

## 六、验证

1. `npx tsc --noEmit` 无新增错误
2. 新建做菜：菜单确认后滚动到 Stage2（不跳转独立页面），进度条正常
3. 做菜全流程：Stage1→2→3→4→5 全部在 Pager 内通过 scrollTo 导航
4. 继续做菜：恢复后当前 stage 可交互，按钮不消失
5. 历史查看：进度条可点，只读状态正确
6. 进度条只在 Pager 底部出现一次
