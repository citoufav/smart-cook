# 更新记录（CHANGELOG）

> 本文件记录项目的历次重要更新，按时间倒序（最新在上）。
> 详细设计决策（ADR）与开发记录见仓库根目录：[../../文档/开发记录/](../../文档/开发记录/)

## 2026-08-13 · 状态管理重构（5 阶段全部完成）

重构动机与完整方案见根目录 [状态管理现状与重构方案.md](../../文档/开发记录/状态管理现状与重构方案.md)。目标：确立单一真相源、理顺 AI 改菜谱链路、清理死代码、统一数据流。**不引入新依赖，沿用 React Context + useReducer。**

| 阶段 | 内容 | Commit |
|------|------|--------|
| A 单一真相源 | `prepSteps`/`cookingSteps`/`preciseNutrition` 只存于 `MenuProposal`，删除冗余的 `generatedPlan`；`RESTORE_SESSION` 兼容旧数据回填 | `72ea8ea` |
| B 抽纯函数 | 新增 `recipeEditService.applyRecipeChanges()`，ChatSheet 只做 dispatch + persist | `e3d73ab` |
| C 清死代码 | 删除 weighing/bowl 阶段类型、重复组件、废弃 storageKey、`bowlValidation.ts`（-999 行） | `6ee0889` |
| D 收敛历史 | 新增 `MenuHistoryContext`，历史页统一经 context 读取；`handleStreamDone` 单次构造 `menuProposal` 复用到 3 处 | `00a7d38` |
| E 清退化模型 | 删除 `completedStageIndex` 三状态模型与 `useStageMode`，`status` 成为唯一进度来源 | `e72f226` |

## 2026-08-13 · 项目文档收敛

- `docs/` 下 16 个 ADR + 状态管理方案共 17 个 md 迁移至仓库根目录 `文档/开发记录/`，并建立分类索引 `README.md`
- `docs/` 瘦身为门面目录：仅保留 `ARCHITECTURE.md`、`README.md` 与本文档
- 清理 `SmartCook_demo/.trae` 与根目录 `.trae/` 中的残留文档副本

## 2026-08-13 · 文档体系建设

- 新增英文 README、架构文档（`ARCHITECTURE.md`）与一批设计决策记录（ADR），覆盖烹饪流程演进、AI 聊天改菜谱、UI 打磨等主题（`efd8f2f`）

## 2026-08-13 · 工程基线整理

- gitignore 优化，`node_modules` 取消跟踪，建立可复现的基线工作状态（`299e162`）

## 2026-06-09 · 项目初始化

- 初始化 Expo + React Native + TypeScript 项目（`46b3748`）
- 修复构建产物与 Hermes/构建属性配置（`1987fbd`、`b9c1aca`）
