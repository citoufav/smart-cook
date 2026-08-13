# Stage5 标签修复、进度条导航优化、Alert 替换

## 一、当前状态分析

### 1. Stage5 标签解析问题

**`InstructionText` 组件**（[stage5-cooking.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/app/cooking/stage5-cooking.tsx#L22-L70)）：

正则 `/\[(.+?)\((\d+)g\)\]|\[碗(\d+)\]/g` 有两个分支：
| 分支 | 匹配 | 问题 |
|------|------|------|
| `\[(.+?)\((\d+)g\)\]` | `[食材名(数字g)]` | 不匹配 `[食用油(少许)]`（非数字） |
| `\[碗(\d+)\]` | `[碗N]` | 不匹配 `碗N]`（缺 `[`） |

**问题 A — 中括号混乱**：AI 输出 `碗1]放入电饭煲，加入[清水(120g)`（缺开括号的碗标签、缺闭括号的食材标签）。正则无法匹配，原样渲染为纯文本。

**问题 B — 非克重标签无色**：`[食用油(少许)]` 中 `少许` 不是数字，正则不匹配，无背景色。

**问题 C — 碗标签无食材名**：只显示 `碗1`，用户无法辨识对应菜品。`bowlAssignments` 中有 `ingredients: ["大米", "火腿丁"]` 可用但未引用。

### 2. 进度条导航逻辑

**`handleStagePress`**（[CookingProgressBar.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/src/components/CookingProgressBar.tsx#L28-L33)）：
- 使用 `router.push()` → 每次点击推入新页面
- 多次点击后栈深大，需要多次返回
- 从 stage5 跳到 stage2 → `slide_from_right` 动画反直觉（应该从左边回来）

**Stage1-menu 只读模式缺失**（[stage1-menu.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/app/cooking/stage1-menu.tsx#L189-L193)）：
- 底部按钮"返回修改"和"确认菜单，开始称量"在只读模式下仍然可见可点
- 没有读取 `readonly` query 参数

### 3. 原生 Alert 不协调

[stage5-cooking.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/app/cooking/stage5-cooking.tsx#L157-L164) 和 [inventory-update.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/app/cooking/inventory-update.tsx#L84-L93) 使用 `Alert.alert()` 原生对话框，风格与 App 设计语言不一致。

### 4. 库存更新按钮间距

[inventory-update.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/app/cooking/inventory-update.tsx#L219) `paddingBottom: 100` 过大。

---

## 二、修改方案

### 2.1 Stage5 标签解析修复（`app/cooking/stage5-cooking.tsx`）

#### 2.1.1 正则扩展 + 文本预处理

新增预处理函数 `normalizeBrackets(text)`：
- 检测 `碗\d+]`（缺 `[`）→ 自动补为 `[碗\d+]`
- 检测 `\[.+?\(\d+g`（缺 `]`）→ 自动补为 `[.+?(\d+g)]`
- 检测 `\[.+?\(\S+\)`（含非数字内容如少许/适量/勺）→ 视为有效标签

新正则：
```
/\[(.+?)\((\d+)g\)\]|\[碗(\d+)\]|\[(.+?)\((\S+?)\)\]/g
```
新增第三个分支 `\[(.+?)\((\S+?)\)\]` 匹配 `[食用油(少许)]`、`[盐(适量)]` 等。

- `match[1]` + `match[2]` = 食材名 + 克数（数字g）
- `match[3]` = 碗编号
- `match[4]` + `match[5]` = 食材名 + 非克重描述（少许/适量/X勺）

#### 2.1.2 碗标签显示食材名

`InstructionText` 新增 `bowlAssignments` 参数。渲染碗标签时：
1. 根据 `match[3]`（碗编号）查找 `bowlAssignments` 中 `bowlNumber` 匹配的项
2. 取 `ingredients` 数组，用逗号连接
3. 显示格式：`碗1(大米,火腿丁)`

碗标签样式保持不变（白底+主色边框）。

#### 2.1.3 非克重标签渲染

`[食用油(少许)]` 等非克重标签使用实色背景（通过 `ingredientTags` 查颜色），文字显示完整内容如 `食用油(少许)`。

#### 2.1.4 同步修复 stage3-prep `IngredientTagText`

[stage3-prep.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/app/cooking/stage3-prep.tsx#L22-L59) 中的 `IngredientTagText` 同样扩展正则，增加非克重标签匹配分支。该组件仅在 prep 阶段使用，不需要碗标签支持。

---

### 2.2 AI 提示词收束（`src/services/aiService.ts`）

在 `SYSTEM_PROMPT_CN` 末尾追加规则：
```
21. **标签格式严格要求**：[食材名(克重)] 和 [碗N] 标签的方括号必须完整闭合，不允许出现 碗1] 或 [清水(120g 等断括号。非克重调料（油、盐等）使用克数，如需特别说明可在标签外用文字描述。
```

在 `buildStage2UserPrompt` 的规则中加入：
```
9. 所有 [食材名(克重)] 标签必须包含完整闭合的方括号 []，不允许任何单边括号
10. 油类（食用油、香油等）必须给出克重数字，因为油也是称量过的
```

---

### 2.3 进度条导航优化（`src/components/CookingProgressBar.tsx`）

**改动**：
- `handleStagePress` 中 `router.push()` → `router.replace()`
- 移除 `?readonly=1` 参数（因为 readonly 状态由 context/session 中当前阶段与目标阶段的关系决定）
- 新增逻辑：如果目标阶段 index < currentStage 的 index → 目标阶段应包含 `completedStages`，正常使用 `replace` 跳转而非 readonly
- 实际上保持每次一个屏幕，避免栈累积

导航语义：
- 点击已完成或当前阶段 → `router.replace(route)` — 替换当前屏幕
- 点击未来阶段 → 不响应

这样任何时候栈里只有 1 个 cooking 页面，header 返回按钮自然回到 tabs/cooking。

#### 2.3.1 动画方向

[app/cooking/_layout.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/app/cooking/_layout.tsx) 中 Stack 默认 `animation: 'slide_from_right'`。需要在每个 screen 定义中根据是 "前进" 还是 "后退" 动态设置。但 Expo Router 不支持运行时动态 animation。

替代方案：每个 screen 的 animation 保持 `slide_from_right`，但由于使用 `replace` 而非 `push`，用户只会看到一个屏幕替换另一个，动画效果是自然的替换（默认 `slide_from_right` 仍然适用）。

---

### 2.4 Stage1-menu 只读模式（`app/cooking/stage1-menu.tsx`）

**改动**：
- 读取 `readonly` query 参数（`useLocalSearchParams`）
- 当 `isReadonly` 时：隐藏底部"返回修改"和"确认菜单，开始称量"按钮

---

### 2.5 自定义 Alert 组件

创建 [src/components/CustomAlert.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/src/components/CustomAlert.tsx)。

**接口**：
```ts
interface CustomAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons: { text: string; variant?: 'primary' | 'secondary' | 'ghost'; onPress: () => void }[];
  onDismiss?: () => void;
}
```

**设计**：
- 居中模态框，半透明黑色遮罩
- 白色圆角卡片，shadow
- title：17px bold，居中
- message：14px textSecondary，居中
- buttons：水平排列，主按钮 primary 色，次按钮 ghost
- 过渡动画：fade + scale

**替换位置**：
1. [stage5-cooking.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/app/cooking/stage5-cooking.tsx#L155-L164) — `handleDone` 中的 `Alert.alert`
2. [inventory-update.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/app/cooking/inventory-update.tsx#L84-L93) — `handleSave` 成功后的 `Alert.alert`
3. [inventory-update.tsx](file:///e:/program/trae/%E5%81%9A%E9%A5%AD%E8%BD%AF%E4%BB%B6/SmartCook/app/cooking/inventory-update.tsx#L95) — 错误提示 `Alert.alert`

### 2.6 库存更新按钮间距（`app/cooking/inventory-update.tsx`）

**改动**：
- `bottomBar.paddingBottom: 100` → `paddingBottom: SPACING.xl`（20）
- `scrollContent.paddingBottom: 120` → `paddingBottom: SPACING.xxl`（24）

---

## 三、涉及文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/cooking/stage5-cooking.tsx` | 修改 | 正则扩展、文本预处理、碗标签显示食材名、替换 Alert 为 CustomAlert |
| `app/cooking/stage3-prep.tsx` | 修改 | IngredientTagText 正则扩展支持非克重标签 |
| `src/services/aiService.ts` | 修改 | 提示词增加标签格式严格要求 |
| `src/components/CookingProgressBar.tsx` | 修改 | `push` → `replace`，避免栈累积 |
| `app/cooking/stage1-menu.tsx` | 修改 | 增加 readonly 模式隐藏按钮 |
| `src/components/CustomAlert.tsx` | 新建 | 自定义模态对话框组件 |
| `app/cooking/inventory-update.tsx` | 修改 | 替换 Alert 为 CustomAlert；调整按钮间距 |

---

## 四、验证步骤

1. `npx tsc --noEmit` 确保无 TypeScript 错误
2. 验证标签：
   - 正常克重标签 `[大米(200g)]` — 彩色背景渲染
   - 非克重标签 `[食用油(少许)]` — 彩色背景渲染（显示完整文本）
   - 碗标签 `[碗1]` — 显示 `碗1(大米,火腿丁)` 格式
   - 破损标签 `碗1]` — 自动修复为 `[碗1]` 后正常渲染
3. 验证导航：
   - 从 stage5 点进度条到 stage2 → 替换当前屏，无栈累积
   - stage1-menu 只读模式不显示操作按钮
4. 验证 Alert：自定义对话框风格一致，按钮可点击
5. 验证库存更新页面按钮间距合理
