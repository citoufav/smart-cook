# 设计决策与开发记录 (Design Decisions & Development Records)

> 本目录保存 SmartCook 从 Demo 迭代至今的设计决策与重构记录，按主题归类，体现了项目从「5 阶段流程」演进到「3 阶段流程」、引入 AI 聊天改菜谱、以及多轮状态管理与 UI 打磨的完整思路。
>
> *This directory contains the design decisions and refactoring records of SmartCook. The files are in Chinese and document the project's evolution from a 5-stage cooking flow to a 3-stage flow, the introduction of the AI recipe chat, and iterative state-management and UI improvements.*

## 架构文档 (Architecture)

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 英文架构总览：分层、状态管理、AI 数据流、持久化、设计决策 |

## 功能规划 (Feature Planning)

| 文档 | 说明 |
|------|------|
| [demo_three_features_plan.md](./demo_three_features_plan.md) | Demo 版三功能计划：饮食记忆、设置页重构、做菜聊天窗 |

## 核心流程演进 (Cooking Flow Evolution)

按时间顺序，体现了「5 阶段 → 3 阶段」的核心演进：

| 文档 | 说明 |
|------|------|
| [cooking-flow-refactor-plan.md](./cooking-flow-refactor-plan.md) | 做饭流程重构计划（早期） |
| [cooking-flow-full-refactor.md](./cooking-flow-full-refactor.md) | 流程彻底重构：单一 Pager 架构，修复双导航冲突 |
| [cooking-flow-ultimate-refactor.md](./cooking-flow-ultimate-refactor.md) | 最终重构：删除称量/分装阶段，改为一次性生成完整菜谱（3 阶段） |
| [cooking-core-refactor.md](./cooking-core-refactor.md) | 核心重构补充 |
| [cooking-steps-redesign.md](./cooking-steps-redesign.md) | 步骤展示重设计 |

## 状态管理修复 (State Management)

| 文档 | 说明 |
|------|------|
| [state-management-root-fix.md](./state-management-root-fix.md) | 状态管理根本性修复：5 个关联 bug 的根因与方案 |
| [unified-progress-pager-refactor.md](./unified-progress-pager-refactor.md) | 统一进度 Pager 重构 |
| [tag-brackets-state-inventory-fix.md](./tag-brackets-state-inventory-fix.md) | 标签括号 / 状态 / 库存修复 |

## UI 与交互打磨 (UI & Interaction)

| 文档 | 说明 |
|------|------|
| [ui-style-overhaul-plan.md](./ui-style-overhaul-plan.md) | UI 风格改版方案 |
| [cooking-prompts-and-ui-optimization.md](./cooking-prompts-and-ui-optimization.md) | Prompt 与 UI 优化 |
| [stage5-tags-and-navigation-fix.md](./stage5-tags-and-navigation-fix.md) | Stage5 标签与导航修复 |
| [bottom-spacing-readonly-navigation-animation-fix.md](./bottom-spacing-readonly-navigation-animation-fix.md) | 底部间距 / 只读导航 / 动画修复 |
| [date-picker-history-ball-fix.md](./date-picker-history-ball-fix.md) | 日期选择器 / 历史记录 / 悬浮球修复 |

## 早期 Bug 修复 (Early Bug Fixes)

| 文档 | 说明 |
|------|------|
| [3-bugs-fix-plan.md](./3-bugs-fix-plan.md) | 三 bug 修复计划 |
| [4-bugs-fix-plan.md](./4-bugs-fix-plan.md) | 四 bug 修复计划 |
