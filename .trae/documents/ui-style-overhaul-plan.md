# UI 样式全面调整计划

## 概述

针对设置页、做菜页、库存页的界面样式进行全面调整，包括模型设置重构、忌口标签化、自定义选项、图标替换等。

***

## 一、设置页重构

### 1.1 API Key 移入模型设置卡片

**文件**: `app/(tabs)/settings.tsx`

**变更**:

* 删除独立的 `<Card title="API Key">` 区块（第 61-79 行）

* 在 `<Card title="模型设置">` 内部，API Key 的输入区域放在最下方（模型选择、思考设置之后）

* API Key 显示当前掩码值，输入框 + 显示/隐藏 + 保存按钮保持现有逻辑

### 1.2 DeepSeek 模型改为下拉选择

**文件**: `app/(tabs)/settings.tsx`

**变更**:

* 将 `apiType` 的两个 chip 按钮改为单选逻辑：一个选择器切换 DeepSeek / OpenAI 兼容

* 当选择 DeepSeek 时，模型名改为**下拉选择框**而不是自由文本输入：

  * `deepseek-v4-pro` — 旗舰模型（默认）

  * `deepseek-v4-flash` — 快速模型

* 当选择 OpenAI 兼容时，保持现有的 API 地址 + 模型名称自由输入

* 使用 React Native 的 `Picker` 或自定义 Modal 下拉实现

**实现方式**: 使用自定义 Modal 下拉组件（RN 内置 Picker 在各平台表现不一致，用 TouchableOpacity + FlatList + Modal 实现更可控）

### 1.3 思考强度设置

**文件**:

* `app/(tabs)/settings.tsx` — UI 添加

* `src/types/index.ts` — 类型扩展

* `src/services/settingsService.ts` — 默认值

* `src/services/aiService.ts` — 调用时读取

**类型扩展** (`src/types/index.ts`):

```typescript
export interface UserPreferences {
  // ... 现有字段保持不变
  thinkingEnabled: boolean;        // 新增：是否启用思考模式，默认 false
  reasoningEffort: 'low' | 'medium' | 'high';  // 新增：思考强度，默认 'medium'
}
```

**默认值** (`src/services/settingsService.ts`):

```typescript
thinkingEnabled: false,
reasoningEffort: 'medium',
```

**UI** (`app/(tabs)/settings.tsx`):

* 在 DeepSeek 模型下拉选择下方添加：

  * 思考模式开关（Toggle/Switch）：关闭 / 开启

  * 当开启时，显示思考强度选择（low / medium / high 三个 chip）

* OpenAI 兼容模式下不显示思考设置（思考是 DeepSeek 特有功能）

**AI 服务** (`src/services/aiService.ts`):

* 所有 5 个 API 调用点（`callAIStage1`, `callAIStage1Stream`, `callAIStage2`, `callAIStage2Stream`, `callAIPatch`）：

  * 从 `preferences` 读取 `thinkingEnabled`

  * 如果 `thinkingEnabled === true`：`thinking: { type: 'enabled' }` + `reasoning_effort: preferences.reasoningEffort`

  * 如果 `thinkingEnabled === false`：保持现状 `thinking: { type: 'disabled' }`

* `reasoning_effort` 仅在 DeepSeek 模型 + thinking 开启时有效

### 1.4 忌口设置改为标签式

**文件**: `app/(tabs)/settings.tsx`

**问题**: 当前使用 `TextInput multiline` + `\n` 分隔，占位符里的 `\n` 在某些渲染环境下可能显示异常。

**变更**:

* 删除多行 TextInput

* 改为：一个单行 TextInput + "添加" 按钮

* 下方显示已添加的忌口标签（chip/tag 形式，带 × 删除按钮）

* 数据仍用 `dietaryRestrictions: string[]`，无需改类型

* 标签样式：圆角 chip，带背景色，右侧 × 可点击删除

**交互流程**:

1. 用户在输入框输入忌口项（如"不吃辣"）
2. 点击"添加"按钮或按回车
3. 标签出现在下方列表中
4. 点击标签上的 × 删除该标签
5. 点击"保存"按钮一次性提交所有标签

### 1.5 删除历史记录卡片

**文件**: `app/(tabs)/settings.tsx`

**变更**: 删除第 131-139 行的 `<Card title="历史记录">` 整个区块。做菜页面已有历史记录入口，设置页不再需要。

***

## 二、做菜页调整

### 2.1 用餐人数、餐类、热量偏好增加自定义选项

**文件**:

* `app/(tabs)/cooking.tsx` — UI + 逻辑

* `src/constants/cooking.ts` — 选项常量

**常量扩展** (`src/constants/cooking.ts`):

```typescript
export const PEOPLE_OPTIONS = [
  { label: '1人', value: 1 },
  { label: '2人', value: 2 },
  { label: '3人', value: 3 },
  { label: '4人', value: 4 },
  { label: '自定义', value: -1 },  // 新增
];

export const MEAL_TYPE_OPTIONS = [
  { label: '不限', value: 'any' },
  { label: '早餐', value: 'breakfast' },
  { label: '午餐', value: 'lunch' },
  { label: '晚餐', value: 'dinner' },
  { label: '自定义', value: 'custom' },  // 新增
];

export const CALORIE_OPTIONS = [
  { label: '不限制', value: undefined },
  { label: '300卡', value: 300 },
  { label: '500卡', value: 500 },
  { label: '700卡', value: 700 },
  { label: '1000卡', value: 1000 },
  { label: '自定义', value: -1 },  // 新增
];
```

**UI 逻辑** (`app/(tabs)/cooking.tsx`):

* 当用户点击"自定义" chip 时，弹出 `Alert.prompt` 输入框（iOS）/ 自定义 Modal（Android 兼容）

  * 人数：数字键盘，输入人数

  * 餐类：文本输入，自由描述

  * 热量：数字键盘，输入目标卡路里数

* 自定义值存储：

  ```typescript
  const [customPeople, setCustomPeople] = useState<number | null>(null);
  const [customMealType, setCustomMealType] = useState<string>('');
  const [customCalorie, setCustomCalorie] = useState<number | null>(null);
  ```

* Chip 选中状态：当选择了"自定义"时，该 chip 高亮，label 显示为实际输入值（如"5人"）

* 提交给 AI 时，优先使用自定义值

### 2.2 "继续之前的做菜" → "历史记录"

**文件**: `app/(tabs)/cooking.tsx`

**变更**: 第 405 行文案从 `继续之前的做菜` 改为 `历史记录`

***

## 三、库存页图标替换

### 3.1 删除按钮图标

**文件**: `app/(tabs)/index.tsx`

**变更**:

* 将删除按钮从 emoji `🗑️` 替换为 Ionicons `trash-outline` 图标

* 导入: `import { Ionicons } from '@expo/vector-icons';`

* 渲染:

  ```tsx
  <Ionicons name="trash-outline" size={20} color={COLORS.textTertiary} />
  ```

* 删除 `deleteBtn` 样式中的 `fontSize` 和 `paddingLeft`，改为 `padding: 8`

### 3.2 底部导航栏图标

**文件**: `app/(tabs)/_layout.tsx`

**变更**:

* 将三个 Tab 图标从 emoji 替换为 Ionicons 矢量图标

* 导入: `import { Ionicons } from '@expo/vector-icons';`

* 修改 `TabIcon` 组件使用 Ionicons:

  ```typescript
  const TAB_ICONS: Record<string, { focused: string; unfocused: string }> = {
    inventory: { focused: 'cube', unfocused: 'cube-outline' },
    restaurant: { focused: 'restaurant', unfocused: 'restaurant-outline' },
    settings: { focused: 'settings', unfocused: 'settings-outline' },
  };

  function TabIcon({ name, color, size, focused }: { name: string; color: string; size: number; focused: boolean }) {
    const icons = TAB_ICONS[name];
    if (!icons) return <Ionicons name="help-circle-outline" size={size} color={color} />;
    return <Ionicons name={focused ? icons.focused : icons.unfocused} size={size} color={color} />;
  }
  ```

* Tab.Screen 的 `tabBarIcon` 需要传入 `focused` 参数:

  ```typescript
  tabBarIcon: ({ color, size, focused }) => <TabIcon name="inventory" color={color} size={size} focused={focused} />,
  ```

***

## 四、涉及文件清单

| 文件                                | 变更类型 | 说明                                                  |
| --------------------------------- | ---- | --------------------------------------------------- |
| `app/(tabs)/settings.tsx`         | 重写部分 | API Key 移入模型设置，模型下拉，思考设置，忌口标签化，删历史卡片                |
| `app/(tabs)/cooking.tsx`          | 修改   | 自定义选项，文案修改                                          |
| `app/(tabs)/_layout.tsx`          | 修改   | Tab 图标改为 Ionicons                                   |
| `app/(tabs)/index.tsx`            | 修改   | 删除按钮图标改为 Ionicons                                   |
| `src/constants/cooking.ts`        | 修改   | 添加自定义选项常量                                           |
| `src/types/index.ts`              | 修改   | UserPreferences 添加 thinkingEnabled, reasoningEffort |
| `src/services/settingsService.ts` | 修改   | 默认值添加 thinking 相关字段                                 |
| `src/services/aiService.ts`       | 修改   | 5 处 API 调用读取 thinking 配置                            |

***

## 五、实现顺序

1. **类型 + 默认值**: 扩展 `UserPreferences`，更新 `settingsService` 默认值
2. **设置页**: 重构整个 settings.tsx（API Key、模型下拉、思考设置、忌口标签、删历史卡片）
3. **做菜页**: 自定义选项 + 文案修改
4. **AI 服务**: 5 处 API 调用接入 thinking 配置
5. **库存页**: 删除图标替换
6. **导航栏**: Tab 图标替换
7. **验证**: TypeScript 编译无错误，各项功能正常

***

## 六、验证步骤

1. `npx tsc --noEmit` — 确保无类型错误
2. 设置页：API Key 在模型设置卡片内，DeepSeek 下拉可选两个模型
3. 设置页：思考模式开关可切换，强度可选 low/medium/high
4. 设置页：忌口输入为标签式，可添加/删除标签
5. 设置页：不显示历史记录卡片
6. 做菜页：三个选项各有"自定义" chip，点击弹输入框
7. 做菜页：文案显示为"历史记录"
8. 库存页：删除按钮为 Ionicons 图标
9. 导航栏：三个 Tab 图标为 Ionicons 矢量图标

