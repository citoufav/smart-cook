# 标签括号 + 状态管理 + 库存调料 修复计划

## 一、问题分析

### 1.1 标签方括号异常（stage3-prep + stage5-cooking）

**现象**：`小葱(15g])`、`食用油(5g])` —— 内容后面多了 `]`；`[碗2(腊肠)` —— 缺 `]`

**根因**：`normalizeBrackets()` 只处理两种特定破损：

* `碗1]` → `[碗1]`（碗标签缺 `[`）

* `[清水(120g` → `[清水(120g)]`（标签缺 `]`）

但**不处理** `xxx(数字g])` 这种 AI 输出中常见的情况——没有开括号 `[`，末尾却多了一个 `]`。

正则匹配逻辑：`InstructionText` 的正则 `/\[(.+?)\((\d+)g\)\]/` 要求完美格式，所以 `小葱(15g])`（多了 `]`）连匹配都匹配不上，原样渲染。

**影响范围**：

* [stage5-cooking.tsx](file:///e:/program/trae/做饭软件/SmartCook/app/cooking/stage5-cooking.tsx#L22-L28) — `normalizeBrackets` + `InstructionText`

* [stage3-prep.tsx](file:///e:/program/trae/做饭软件/SmartCook/app/cooking/stage3-prep.tsx#L22-L26) — `normalizeBrackets` + `IngredientTagText`

### 1.2 进度条改变会话状态

**现象**：在制作（stage5）时点进度条回看之前步骤，制作状态也被跳回去了。

**根因分析**：当前 `CookingPager` 的 `handleProgressBarPress` 只做 `scrollTo`，不 dispatch。但**隐患**在于：

1. `handleStageComplete`（第72行）无条件 dispatch `SET_CURRENT_STAGE`，作为 `onComplete` 传给 stage2-stage5
2. 用户如果在 readonly 页面误触了"完成"按钮（或组件内部意外调用 `onComplete`），状态就会被修改
3. `_layout.tsx` 仍保留了 5 个旧 stage 路由——如果用户通过旧路径进入（如手动输入 URL），旧页面的 `setCurrentStage` 或 `router.push` 会改变状态

**修复方向**：

* Pager flow：增加防护——只允许 `handleStageComplete` 在当前 interactive 阶段被调用时才生效

* 旧路由：从 `_layout.tsx` 移除 `stage2-weighing`/`stage3-prep`/`stage4-bowl`/`stage5-cooking` 四个独立 Screen（保留 `stage1-menu` 用于兼容？不，全部移除让它们只能通过 pager 访问）

### 1.3 库存更新调料消耗为空

**现象**：inventory-update 页面的"调料消耗"区域一个都没加载。

**根因**：`seasoningSuggestions` 在以下任一条件下返回空数组：

1. `weighingData` 为 `undefined`
2. `weighingData.availableSeasonings` 为空数组
3. 所有调料被用户取消勾选（`isAvailable: false`）

最可能的原因是第 1 种——`cookingState.session?.stages.weighing` 为 undefined。这发生在：

* 从 pager 进入 inventory-update 时 session 中确实有 weighing 数据（正常 flow）→ 应正常

* 从旧记录恢复时，旧 session 可能没有 `weighing`（旧版本只存到 `generatedPlan`，不单独存 `weighing`）

**修复方向**：添加 fallback——如果 `weighingData` 不存在但 `generatedPlan` 存在，从 `menuProposal.dishes` 推导调料列表。

### 1.4 旧记录兼容问题

用户表示："老版本的记录查看和继续的状态管理乱了，不管了"。不需要修复旧记录兼容。

***

## 二、修改方案

### 2.1 标签括号修复

**文件**：`app/cooking/stage5-cooking.tsx` + `app/cooking/stage3-prep.tsx`

两个文件中的 `normalizeBrackets` 函数增加第三条规则：

```typescript
function normalizeBrackets(text: string): string {
  return text
    // 碗1] → [碗1]
    .replace(/(碗\d+)\]/g, '[$1]')
    // [清水(120g → [清水(120g)]
    .replace(/\[(.+?\(\d+)g(?!\])/g, '[$1g]')
    // 新增：小葱(15g]) → 小葱(15g)  （去除非括号内的尾随 ]）
    .replace(/\((\d+)g\)\]/g, '($1g)');
}
```

逻辑：如果 `(数字g)` 后面跟着一个孤立的 `]`（没有前置 `[`），去掉这个 `]`。

### 2.2 状态管理防护

**文件**：`src/components/CookingPager.tsx`

修改 `handleStageComplete`，增加当前阶段校验：

```typescript
const handleStageComplete = useCallback(() => {
    const currentIdx = getStageIndex(session.status);
    const nextIndex = currentIdx + 1;
    if (nextIndex >= STAGE_KEYS.length) {
      // Stage5 完成 → 导航到库存更新
      router.push('/cooking/inventory-update');
      return;
    }
    const nextStage = STAGE_KEYS[nextIndex];
    dispatch({ type: 'SET_CURRENT_STAGE', payload: nextStage });
    scrollRef.current?.scrollTo({ x: nextIndex * screenWidth, animated: true });
}, [session.status, dispatch, screenWidth]);
```

关键改动：用 `session.status`（实时值）替代 `statusIndex`（闭包捕获的旧值），确保 always operate on latest state。

**文件**：`app/cooking/_layout.tsx`

移除 4 个独立 stage Screen（`stage2-weighing`、`stage3-prep`、`stage4-bowl`、`stage5-cooking`），确保用户只能通过 pager 访问这些页面。

`stage1-menu` 和 `shopping-list` 保留（stage1-menu 在 pager 内渲染，独立路由可用于兼容）。

### 2.3 库存调料 fallback

**文件**：`app/cooking/inventory-update.tsx`

在 `seasoningSuggestions` 的 useMemo 中增加 fallback：

```typescript
const seasoningSuggestions = useMemo(() => {
    // 优先使用 weighingData
    if (weighingData?.availableSeasonings?.length) {
      const usedNames = weighingData.availableSeasonings
        .filter((s: any) => s.isAvailable)
        .map((s: any) => s.seasoningName);
      return calculateSeasoningSuggestions(usedNames, invState.seasonings);
    }
    // Fallback：从 menuProposal 推导
    const menu = cookingState.session?.stages.menu?.menuProposal;
    if (menu) {
      const names = new Set<string>();
      for (const dish of menu.dishes) {
        for (const s of dish.seasonings) {
          names.add(s.name);
        }
      }
      return calculateSeasoningSuggestions([...names], invState.seasonings);
    }
    return [];
}, [weighingData, invState.seasonings, cookingState.session]);
```

***

## 三、文件变更清单

| 文件                                 | 操作 | 说明                                                                  |
| ---------------------------------- | -- | ------------------------------------------------------------------- |
| `app/cooking/stage5-cooking.tsx`   | 修改 | `normalizeBrackets` 增加 `(数字g)]` → `(数字g)` 规则                        |
| `app/cooking/stage3-prep.tsx`      | 修改 | 同上                                                                  |
| `src/components/CookingPager.tsx`  | 修改 | `handleStageComplete` 用 live `session.status`；cooking 完成跳 inventory |
| `app/cooking/_layout.tsx`          | 修改 | 移除 4 个旧 stage Screen                                                |
| `app/cooking/inventory-update.tsx` | 修改 | 调料 suggestions 增加 menuProposal fallback                             |

***

## 四、验证步骤

1. `npx tsc --noEmit` — 无新增 TS 错误
2. 标签验证：AI 输出 `小葱(15g])` 会被修正为 `小葱(15g)`，正确渲染为彩色标签
3. 状态验证：在 stage5 点进度条回看 stage3 → 状态仍为 cooking，不回退
4. 状态验证：complete stage4 bowl → 自动滑到 stage5，状态变为 cooking
5. 库存验证：完成做菜后进入 inventory-update → 调料消耗正常显示

