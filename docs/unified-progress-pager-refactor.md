# 统一进度管理 + 水平滑动导航 + 三状态模型 重构计划

## 一、问题分析

### 1.1 底部空白（库存页 + 设置页）

| 页面 | 当前值 | 问题 |
|------|--------|------|
| `app/(tabs)/index.tsx` (库存) | `list.paddingBottom: 100` | 硬编码 100px |
| `app/(tabs)/settings.tsx` (设置) | `content.paddingBottom: 120` | 硬编码 120px |

这两个值远大于参考值 `SPACING.xxl`(24) 或 `SPACING.sm`(8)。

### 1.2 进度管理分散

当前 `CookingSession` 仅用 `status: CookingStage` 追踪当前位置：
```typescript
interface CookingSession {
  status: CookingStage;  // 单一字段，只知道"停在哪"
  stages: CookingSessionStages;
  // ❌ 没有 completedStages 数组
  // ❌ 没有 isReadonly 标志
  // ❌ 没有阶段锁定机制
}
```

**后果**：
- 进度条"已完成"状态从页面硬编码 `completedStages` 推导，跨页面跳转时不一致
- 已完成的旧阶段可被修改（无 readonly 保护）
- 未开始阶段无路由守卫（仅 UI 层 disabled）
- 只读模式仅靠 URL 参数 `?readonly=1` 传递，非全局管理

### 1.3 导航跳转混乱

| 导航 | 使用方式 | 问题 |
|------|---------|------|
| stage2 → stage3 | `router.replace` | 与其余 `router.push` 不一致 |
| ProgressBar 跳转 | `router.push` | 每次叠加新页面，栈不断增长 |
| 各页面自行 dispatch | `SET_CURRENT_STAGE` | Context 状态与路由不同步 |

### 1.4 用户期望

- 5 个阶段页面固定左右排列（菜谱→称量→备菜→分装→制作）
- 每个页面有三种状态：**已完成（只读）**、**进行中（可操作）**、**未开始（锁定）**
- 通过水平滑动在相邻已解锁页面间切换
- 全局统一管理当前进展，点进任何食谱都是一致的进度模型

---

## 二、架构设计

### 2.1 整体方案

**替换当前 expo-router Stack 多路由模式为单路由 + 水平 Pager 模式：**

```
改造前（当前）:
  expo-router Stack
    ├── stage1-menu.tsx      (独立路由)
    ├── stage2-weighing.tsx  (独立路由)
    ├── stage3-prep.tsx      (独立路由)
    ├── stage4-bowl.tsx      (独立路由)
    └── stage5-cooking.tsx   (独立路由)
  每个页面各自判断 readonly、各自 dispatch、各自导航

改造后:
  expo-router Stack
    └── pager.tsx              (唯一路由)
          └── CookingPager  (水平滑动容器)
                ├── [菜单确认]  ← readonly | interactive | locked
                ├── [称量与调料] ← readonly | interactive | locked
                ├── [切菜备菜]   ← readonly | interactive | locked
                ├── [分装成碗]   ← readonly | interactive | locked
                └── [按碗炒制]   ← readonly | interactive | locked
  全局 Context 管理状态，每个阶段组件接收 mode prop
```

### 2.2 三状态模型定义

```typescript
type StageMode = 'locked' | 'readonly' | 'interactive';

// 阶段状态判断规则（在 Context 中统一计算）：
// - stageIndex < currentStageIndex  → 'readonly'（已完成）
// - stageIndex === currentStageIndex → 'interactive'（进行中）
// - stageIndex > currentStageIndex  → 'locked'（未开始）
```

**各模式下页面行为：**

| 模式 | 可见性 | Checkbox | Button | 输入框 | ProgressBar 导航 |
|------|--------|----------|--------|--------|-----------------|
| `interactive` | 正常渲染 | 可勾选 | 可点击 | 可编辑 | 可点击已解锁节点 |
| `readonly` | 正常渲染（内容变灰） | 禁用+显示已勾选状态 | 隐藏 | 只读 | 可点击已解锁节点 |
| `locked` | 显示锁屏占位 | — | — | — | future 节点不可点击 |

---

## 三、实现步骤

### Phase 1：Context 层 — 统一进度管理

**文件：`src/contexts/CookingContext.tsx`**

改动：
1. 在 `CookingSession` 中新增 `completedStageIndex: number`（0-based，表示已完成到哪个阶段）
2. 新增 `currentStageIndex: number`（从 `status` 映射：menu=0, weighing=1, prep=2, bowl=3, cooking=4）
3. 新增工具函数 `getStageMode(stageIndex, currentIndex): StageMode`
4. 新增 action：`ADVANCE_TO_NEXT_STAGE` — 将 `completedStageIndex` +1，更新 `status`
5. 修改现有 actions（`COMPLETE_ALL_PREP` 等）同步更新 `completedStageIndex`
6. 导出 `useStageMode(stageIndex)` hook 供各阶段组件使用

**新增类型：**
```typescript
// src/types/index.ts
export type StageMode = 'locked' | 'readonly' | 'interactive';

// CookingSession 新增字段
interface CookingSession {
  // ...existing fields
  completedStageIndex: number;  // 0-4，已完成到的最大阶段索引
}

// 工具函数
export function getStageKeyByIndex(index: number): CookingStage {
  const map: CookingStage[] = ['menu', 'weighing', 'prep', 'bowl', 'cooking'];
  return map[index] || 'menu';
}

export function getStageIndex(stage: CookingStage): number {
  const map: Record<string, number> = { menu: 0, weighing: 1, prep: 2, bowl: 3, cooking: 4 };
  return map[stage] ?? 0;
}
```

### Phase 2：创建 CookingPager 组件

**新文件：`src/components/CookingPager.tsx`**

核心结构：
```tsx
// 水平 FlatList，pagingEnabled，每个 item 是完整的阶段页面
<View style={{ flex: 1 }}>
  <FlatList
    ref={flatListRef}
    horizontal
    pagingEnabled
    scrollEnabled={/* 仅允许滚动到相邻已解锁页面 */}
    data={STAGE_PAGES}  // 5 个阶段
    renderItem={({ item, index }) => (
      <View style={{ width: screenWidth, flex: 1 }}>
        <StagePage stageIndex={index} mode={getStageMode(index)} />
      </View>
    )}
    onScroll={handleScroll}  // 拦截非法滚动
    initialScrollIndex={currentStageIndex}
    getItemLayout={getItemLayout}
  />
  <CookingProgressBar ... />
</View>
```

**各阶段页面内联渲染：**
- `StagePage` 根据 `stageIndex` 路由到对应组件
- 每个原有 stage 组件改造为接收 `mode: StageMode` prop
- `stage1-menu` → `<MenuConfirm mode={mode} />`
- `stage2-weighing` → `<WeighingStage mode={mode} />`
- `stage3-prep` → `<PrepStage mode={mode} />`
- `stage4-bowl` → `<BowlStage mode={mode} />`
- `stage5-cooking` → `<CookingStage mode={mode} />`

**滚动守卫逻辑：**
```typescript
// 只允许滚动到相邻已解锁页面
const handleScroll = (event) => {
  const targetIndex = Math.round(event.nativeEvent.contentOffset.x / screenWidth);
  if (targetIndex > currentStageIndex + 1) {
    // 不能跳到未开始页面 → 弹回
    flatListRef.current?.scrollToIndex({ index: currentStageIndex + 1, animated: false });
  }
};
// 更简单的做法：用 scrollEnabled 控制 — 但会完全禁用滚动
// 折中：使用 onScrollBeginDrag 判断方向，若向 locked 区域拖拽则阻止
```

**简化方案**：不使用 FlatList，使用 `Animated.ScrollView` + `useAnimatedRef` + `scrollTo`。手动管理 5 个全宽子视图，监听滑动手势。这是最可靠的方式来实现"只能滑动到相邻解锁页面"。

### Phase 3：改造 5 个阶段页面组件

每个阶段页面从"独立路由页面"改造为"可接收 mode prop 的组件"。

**改造模式（以 stage3-prep 为例）：**

```tsx
// 改造前：独立路由页面
export default function Stage3PrepScreen() {
  const params = useLocalSearchParams<{ readonly?: string }>();
  const isReadonly = params.readonly === '1';
  // ...组件逻辑
}

// 改造后：接收 mode prop
interface StagePageProps {
  mode: StageMode;
  onComplete?: () => void;  // 回调通知父组件进入下一阶段
}

export function PrepStage({ mode, onComplete }: StagePageProps) {
  const isReadonly = mode === 'readonly';
  const isLocked = mode === 'locked';
  
  if (isLocked) {
    return <LockedPlaceholder stageName="切菜备菜" />;
  }
  // ...原有逻辑，isReadonly 控制交互元素
}
```

**每个组件需要调整的点：**
- 移除 `useLocalSearchParams` 对 readonly 的读取
- 移除 `router.push` / `router.replace` 导航调用 → 改为调用 `onComplete()`
- `useFocusEffect` 中的自动保存保留
- `CookingProgressBar` 移除（进度条统一在 Pager 外部渲染）
- locked 状态显示占位 UI

### Phase 4：创建新路由入口

**文件：`app/cooking/pager.tsx`**

```tsx
export default function CookingPagerScreen() {
  const { state } = useCooking();
  const currentStageIndex = getStageIndex(state.session?.status || 'menu');
  
  if (!state.session) {
    return <RedirectToEntry />;
  }
  
  return <CookingPager initialStage={currentStageIndex} />;
}
```

**修改 `app/cooking/_layout.tsx`：**
```tsx
<Stack screenOptions={{ ... }}>
  <Stack.Screen name="pager" options={{ headerShown: false }} />
  <Stack.Screen name="shopping-list" options={{ title: '采购清单' }} />
  <Stack.Screen name="inventory-update" options={{ title: '库存更新' }} />
  {/* 移除 5 个 stage 的独立 Screen */}
</Stack>
```

**修改 `app/(tabs)/cooking.tsx` 入口导航：**
- AI 生成完成后：`router.push('/cooking/pager')`（替代 `router.push('/cooking/stage1-menu')`）
- 恢复进度：同样改为 `router.push('/cooking/pager')`

### Phase 5：底部空白修复

**文件：`app/(tabs)/index.tsx`**
- `list.paddingBottom: 100` → `paddingBottom: SPACING.xl` (20)

**文件：`app/(tabs)/settings.tsx`**
- `content.paddingBottom: 120` → `paddingBottom: SPACING.xl` (20)

### Phase 6：清理

- 删除 `CookingProgressBar` 的 `readonly` prop（进度条不再需要单独判断）
- 简化 `CookingProgressBar`：仅接收 `currentIndex` 和 `completedIndex`，内部计算 status
- 移除 5 个旧 stage 路由文件中对 `router` 导航的依赖

---

## 四、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/types/index.ts` | 修改 | 新增 `StageMode`、`CookingSession.completedStageIndex`、工具函数 |
| `src/contexts/CookingContext.tsx` | 修改 | 新增 `completedStageIndex` 管理、`useStageMode` hook |
| `src/components/CookingPager.tsx` | **新建** | 水平滑动容器，管理 5 个阶段页面的渲染和切换 |
| `app/cooking/pager.tsx` | **新建** | 路由入口页面 |
| `app/cooking/_layout.tsx` | 修改 | 用 `pager` 替代 5 个 stage Screen |
| `app/cooking/stage1-menu.tsx` | 修改 | 改为接收 `mode` prop 的组件，移除路由依赖 |
| `app/cooking/stage2-weighing.tsx` | 修改 | 同上 |
| `app/cooking/stage3-prep.tsx` | 修改 | 同上 |
| `app/cooking/stage4-bowl.tsx` | 修改 | 同上 |
| `app/cooking/stage5-cooking.tsx` | 修改 | 同上 |
| `src/components/CookingProgressBar.tsx` | 修改 | 简化 props，接收 `currentIndex` + `completedIndex` |
| `app/(tabs)/cooking.tsx` | 修改 | 入口导航改为 `/cooking/pager` |
| `app/(tabs)/index.tsx` | 修改 | 底部空白 100 → 20 |
| `app/(tabs)/settings.tsx` | 修改 | 底部空白 120 → 20 |

---

## 五、关键决策

1. **Pager 实现方式**：使用 React Native 原生 `ScrollView` + `pagingEnabled` + `scrollEnabled` 条件控制，而非 FlatList。ScrollView 对 5 个固定子视图的渲染更简单可靠。

2. **滚动到locked页面的处理**：使用 `onScrollBeginDrag` 事件监听，如果用户试图向 locked 区域滑动则调用 `scrollTo` 弹回当前位置。

3. **进度条位置**：固定在 Pager 底部（独立于 ScrollView），始终可见。点击进度条节点 → `scrollTo({ x: targetIndex * screenWidth, animated: true })`。

4. **锁定占位 UI**：locked 页面显示一个居中锁图标 + "请先完成前面的步骤" 提示。不渲染该阶段的实际内容（避免数据依赖问题）。

5. **兼容历史记录查看**：历史记录查看功能保留，进入时 `initialScrollIndex` 设置为记录中的 `currentStageIndex`，所有 `≤ completedStageIndex` 的阶段为 readonly。

---

## 六、验证步骤

1. `npx tsc --noEmit` — 无新增 TS 错误
2. 正常做菜流程：菜单→称量→备菜→分装→炒制，每完成一个阶段可左滑回看（只读），右滑到下一个（可操作）
3. 尝试滑到未开始页面 → 被弹回
4. 已完成的阶段：所有按钮隐藏、checkbox 禁用且保持勾选状态
5. 进度条正确反映当前、已完成、未开始
6. 库存页和设置页底部不再有大块空白
7. 历史记录查看：所有已完成页面只读，进度条可点击跳转
