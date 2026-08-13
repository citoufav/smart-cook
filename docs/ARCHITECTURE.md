# SmartCook Architecture

This document describes the high-level architecture, data flow, and state management of SmartCook. It is written for contributors and reviewers who want to understand how the app is structured without reading every file.

## 1. Overview

SmartCook is a **fully client-side** mobile app. There is no backend server:

- **Data persistence** is local only, via `AsyncStorage` (bulk data) and `SecureStore` (secrets such as the API key).
- **AI inference** is called directly from the app using the user's own API key against a configurable OpenAI-compatible endpoint (DeepSeek by default).
- **Streaming** uses Server-Sent Events (SSE) over `fetch` (see `src/utils/sseStream.ts`).

This design keeps deployment trivial (no server to run) and protects user privacy (data never leaves the device except to the AI endpoint the user configures).

## 2. Layering

```
app/  (Expo Router screens)
  │  renders
  ▼
src/components  (UI, consume contexts)
  │  dispatch / read
  ▼
src/contexts    (state via React Context + useReducer)
  │  call
  ▼
src/services    (business logic, persistence, AI calls)
  │  use
  ▼
src/utils       (pure helpers)  +  src/types (shared types)  +  src/constants (config)
```

Rules of thumb:

- **Screens/components** never talk to `AsyncStorage` directly; they go through contexts and services.
- **Contexts** own state and expose narrow actions; they are the single place where state transitions happen.
- **Services** encapsulate side effects (storage I/O, network, AI streaming) and are stateless.
- **Utils** are pure functions with no side effects.

## 3. State Management

State is split into focused contexts, each with a single responsibility:

| Context | Responsibility |
|---------|----------------|
| `SettingsContext` | API key, endpoint, model, dietary restrictions, cooking defaults |
| `InventoryContext` | Ingredients and seasonings |
| `CookingContext` | The active cooking session (current stage, menu proposal, plan) |
| `NutritionContext` | Nutrition data presentation (floating ball visibility, totals) |
| `ChatSheetContext` / `ChatBallContext` | UI visibility of the recipe chat assistant |
| `SettingsDrawerContext` | UI visibility of the settings drawer |

`CookingContext` uses `useReducer` with a typed action union and an explicit state machine. The cooking session is modeled as:

```
CookingSession
  ├── id, status (current CookingStage), createdAt, updatedAt, version
  ├── completedStageIndex   (progress tracking)
  └── stages                (accumulated data per stage)
        ├── requirement     (people, meal type, calories, custom request)
        ├── menu            (Stage1Data: menuProposal + requirement + reasoning)
        └── generatedPlan   (prepSteps, cookingSteps, preciseNutrition)
```

### Cooking stages

The current flow has **3 progress stages** (after an earlier 5-stage design was simplified):

```
requirement → menu → prep → cooking → inventoryUpdate → completed
                └─────────── progress stages ───────────┘
```

`STAGE_KEYS = ['menu', 'prep', 'cooking']` in `src/types/index.ts` defines the progress-only stages. Each stage has a mode — `locked`, `readonly`, or `interactive` — computed from the current status and `completedStageIndex`.

## 4. AI Data Flow

### 4.1 Menu generation (Stage 1)

1. The user enters requirements (people, meal type, calories, custom text) on the cooking entry screen.
2. `callAIStage1Stream` (in `src/services/aiService.ts`) builds a prompt from:
   - the current inventory (ingredients + seasonings),
   - the user's requirements and dietary restrictions,
   - recent meals (dietary memory).
3. The request is streamed (SSE). The system prompt enforces a strict JSON schema and a strict bracket-tag syntax `[ingredient(weight)]` in step text.
4. On completion, the JSON is parsed into a `MenuProposal` (dishes, prepSteps, cookingSteps, preciseNutrition, missingItems).
5. `SET_STAGE1_RESULT` writes the result into the `CookingContext` session, and it is persisted via `cookingProgressService` and `menuHistoryService`.

### 4.2 Recipe chat & modification

The chat assistant (`ChatSheet`) reuses the same SSE plumbing (`callAIChatStream`) but without the JSON-schema constraint. When "allow modify" is enabled, it also exposes a `modify_recipe` function-calling tool so the model can propose recipe changes.

The proposed changes are shown to the user for **confirmation before applying**. On confirm, `executeToolCalls` applies the changes to the current session and persists them.

> **Note:** the recipe-modification logic currently lives inside the `ChatSheet` component and manually deep-copies/synchronizes the `menuProposal` and `generatedPlan` copies. This is a known area of complexity and is planned for refactoring into a pure, single-source-of-truth reducer (see `docs/` for the related design notes).

## 5. Persistence

All persisted data uses keys with the `@v1:` prefix (see `src/constants/storageKeys.ts`):

| Key | Purpose |
|-----|---------|
| `@v1:inventory:ingredients` | ingredient list |
| `@v1:inventory:seasonings` | seasoning list |
| `@v1:settings:*` | preferences (API key in SecureStore) |
| `@v1:cooking:progress_records` | cooking progress (resume/history) |
| `@v1:cooking:menu_history` | menu history |
| `@v1:cooking:lastDefaults` | last-used cooking entry defaults |

## 6. Design Decisions (ADR)

The `docs/` directory contains a chronological set of design/refactoring records (in Chinese). Key decisions:

- **5-stage → 3-stage flow**: weighing and bowl-assignment stages were removed to simplify the UX and reduce AI output complexity.
- **One-shot recipe generation**: the AI returns the complete plan (menu + prep + cooking) in a single call, instead of a two-stage generate-then-refine flow.
- **Client-side AI with user's own key**: avoids running a server and keeps user data private, at the cost of asking users to bring their own API key.
- **Bracket-tag convention** `[ingredient(weight)]`: a strict, machine-parseable way to reference ingredients in AI-generated step text.

See `docs/README.md` (if present) for an index.
