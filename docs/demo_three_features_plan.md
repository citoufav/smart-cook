# Demo 版三功能实施计划

> 最小化修改原则。执行中。

---

## 功能一：饮食记忆

### 改动
1. **新建** `src/services/dietMemoryService.ts` — AsyncStorage 存取最近 N 顿菜名
2. **修改** `src/constants/storageKeys.ts` — 新增 `DIET_MEMORY` key
3. **修改** `src/services/aiService.ts` — `buildStage1UserPrompt` 增加 `recentMeals` 参数
4. **修改** `app/(tabs)/cooking.tsx` — 生成前读记忆、成功后写记忆

---

## 功能二：设置页重构（左上角头像 + 侧滑面板）

### 改动
1. **修改** `app/(tabs)/_layout.tsx` — 删除 settings Tab，在 tabs 上方渲染浮动头像（左上角） + SettingsDrawer
2. **新建** `src/components/SettingsDrawer.tsx` — 右侧滑出面板，含原设置页完整 UI

---

## 功能三：做菜聊天窗

### 改动
1. **新建** `src/services/chatService.ts` — 封装聊天 AI 流式调用（不含 JSON 格式约束）
2. **新建** `src/components/ChatSheet.tsx` — 底部聊天面板
3. **修改** `src/components/CookingPager.tsx` — 右下角 FAB + 集成 ChatSheet

---

## 实施顺序
1. 饮食记忆 → 2. 设置页重构 → 3. 做菜聊天窗
