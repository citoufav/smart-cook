# Changelog

All notable changes to this project are documented in this file.

The project is **pre-release** (v1.0.0). Early development history before 2026-08-13 is reconstructed from internal design records and grouped by milestone rather than exact dates.

## 2026-10-30 — Recipe editing rewritten as structured local edits

**Added**

- `src/services/menuEditService.ts` — seven structured edit operations (`set_grams`, `add_ingredient`, `remove_ingredient`, `remove_dish`, `set_person_count`, `replace_dish`, `add_dish`), applied entirely on the client. Derived fields are recomputed in one place: total nutrition, `missingItems` (rebuilt from each dish's `isInInventory`, purchases preserved by name), `preciseNutrition` length, and step renumbering. Changing the serving count rescales grams **including the `[ingredient(Ng)]` tags inside step text**, so the list and the instructions never disagree.
- `scripts/check-menu-edits.mjs` (`npm run check:edits`) — eleven assertions covering local-only edits, nutrition recalculation, purchase-state preservation, step renumbering and the applicability filter.
- `generateOneDishStream` in `aiService` — produces a single dish for "replace this dish" / "add a dish". A few hundred tokens, so it can never hit the output ceiling.
- `src/components/RecipeChangeReview.tsx` — a dedicated bottom-sheet for reviewing changes: grouped per dish, one concrete diff per row, individually toggleable, with a "apply N changes" action.

**Changed**

- **Editing a recipe through chat no longer regenerates the whole menu.** The `modify_recipe(summary)` tool is replaced by `edit_menu(edits[])`: the model emits the minimal set of structured operations, the client applies them locally. Changing a gram value now costs zero API calls instead of two, and cannot accidentally rewrite the dishes nobody asked about.
- The confirmation flow moved out of the chat transcript. It used to be one line of the model's own prose plus a confirm button — the user was approving wording, not numbers. The new panel shows the actual before/after values and lets each change be dropped.
- Chat now re-reads the recipe context at send time. It previously used a snapshot taken when the sheet opened, so after the first edit every later turn reasoned about the stale menu.
- Tool results are fed back to the model as `assistant` messages. They used to be filtered out as local `system` chatter, leaving the model unaware of what it had just changed.
- `SET_REQUIREMENT` was the wrong action for "change the serving count" — it resets `status` to `menu` and would wipe progress mid-cooking. Added `UPDATE_REQUIREMENT`, which only touches the requirement fields.
- Explicit `max_tokens`: 32K for a full menu, 8K for a single dish, 4K for chat. The API defaults to **8K in non-thinking mode**, which silently truncated long menus and then surfaced as a bogus "malformed JSON" error.
- `sseStreamFetch` now reports `finish_reason`; callers turn `length` into an explicit "output was truncated" message instead of blaming the model.

**Fixed**

- DeepSeek's model list is `deepseek-flash` / `deepseek-v4-pro`; `deepseek-v4-flash` is retired. `deepseek-flash` accepts image input, which unblocks the planned photo-based ingredient entry.

**Removed**

- `regenerateMenuStream` and `buildRegeneratePrompt` — recipe editing no longer rewrites the whole menu.
- `ingredientTags` end to end (`MenuProposal` field, `IngredientTag` type, component prop, both screens' plumbing). Tag colours are derived from the ingredient name, so nothing ever populated the field.
- `CookingStep.bowlReferences` — dead since bowl references were dropped, but still declared required.
- The chat-bubble confirm UI and its styles.

## 2026-10-30 — Reserved seams for planned features & inventory fixes

**Added**

- `src/services/aiClient.ts` — single source for the OpenAI-compatible endpoint, model name and auth header. All four call sites (three in `aiService`, one in `chatService`) now route through it, so switching to a cloud proxy later touches one file.
- `locale` and `cuisineIds` on `UserPreferences`, and `expireDate` on `Ingredient` — reserved fields for i18n, multi-cuisine and expiry reminders. Not read by any UI yet; absent on existing data and therefore `undefined`.
- `src/utils/daysSince.ts` — one implementation of "days stored", shared by the inventory list and the Stage 1 prompt.
- `src/utils/ingredientTagParser.ts` plus `scripts/check-ingredient-tags.mjs` (`npm run check:tags`) — splits step text into plain-text and `[ingredient(amount)]` segments. Ten assertions cover the regressions that used to garble brackets.
- **Ingredient tags are now coloured.** `getTagColor(name)` in `constants/colors.ts` hashes the ingredient name against an eight-colour dark palette, so the same ingredient keeps one colour across dishes and menus. Previously every chip was `COLORS.primary`, because nothing ever populated `ingredientTags` — the prompt never asked for it and `parseStage1Result` dropped the field.
- **Cooking proficiency setting** (`UserPreferences.cookingSkill`: beginner / intermediate / experienced, picked from the settings drawer). Beginner spells out heat, temperature, duration and doneness cues; intermediate gives ranges; experienced gets the sequence and quantities only. Gram weights are never dropped at any level — inventory deduction reads `dishes[].ingredients[].estimatedWeight` and shopping-list weights are parsed from the text.
- `docs/BACKLOG.md` gained a roadmap section (R-1…R-7) covering the planned features and which seams are worth reserving in advance.

**Changed**

- **Fixed a second contradiction in the system prompt**: rules 7–9 hard-coded calorie ranges (600–800 kcal for an adult male, 300–500 for breakfast) while the user message simultaneously injected a calorie target. The defaults are now explicitly scoped to "only when the target says 不限". Rule 14 no longer hard-codes a beginner tone — it defers to the new proficiency line in the user message, keeping one source of truth.
- **Prep steps are now grouped per dish instead of merged across dishes.** Rule 11 used to require merging identical cuts of the same ingredient into one step; in practice that left users unsure how much to cut for a single dish. Each dish now carries its own prep steps, and merging only happens within a dish. The prep screen already grouped by `dishName`, so this is a prompt-only change.
- Resolved a contradiction in the system prompt: rule 3 allowed "适量/少许" for seasonings at the menu stage while rule 16 demanded gram weights everywhere. Menu-stage `seasonings[].amount` may now stay descriptive; anything inside `cookingSteps.instruction` must be an exact gram figure.
- The JSON schema example in the prompt used invalid JSON as placeholders (`克数`, `true或false`, `大卡`). Numbers and booleans are now real values so the model has a valid pattern to copy.
- DeepSeek model list updated per the October 2026 API: `deepseek-v4-flash` is retired and replaced by `deepseek-flash` (which accepts image input), and the new `low` thinking level is available. `ReasoningEffort` is now a named type, and stale stored levels fall back to `high`.

**Fixed**

- Duplicate-name check was skipped entirely in edit mode, so renaming an ingredient to an existing name produced two rows with the same name. The check now excludes only the row being edited.
- Ingredient storage age disagreed between screens: the list clamped future dates to `0 天` while the AI prompt reported a negative count. Both now use `daysSince`.
- Searching for a term with no matches rendered a blank area — the empty state only checked whether the whole inventory was empty. It now shows a "no results" state with a clear-search action.
- The per-row date-reset button changed data silently on a mis-tap; it now confirms with an Android toast. iOS gets no feedback yet.
- Ingredient brackets surfaced half-eaten in prep and cooking steps. The old regex `/\[(.+?)\((\S+?)\)\]/` let `.` cross `]`, so `[A(B)] [C(10g)]` collapsed into a single tag `A(B)] [C(10g)`. The parser now forbids brackets and parentheses inside a tag, and additionally accepts full-width parentheses, decimals and spaces in the amount.
- Saving a freshly generated menu could fail silently: `menuHistoryService.add` and `cookingProgressService.save` swallowed write errors, so the UI navigated on as if everything was stored. Both now report failure and the user is warned before anything is lost.

**Removed**

- `src/constants/ingredientColors.ts` — the palette was superseded by the colour the AI returns on each `IngredientTag`.
- `src/hooks/useNetworkStatus.ts` — never referenced. Its `@react-native-community/netinfo` dependency is a native module and stays in `package.json` until the next repackaging.
- Non-streaming `callAIStage1` (~101 lines) plus `AINonRetryableError`, `fetchWithTimeout`, `getRetryDelay` and `sleep`, none of which had a caller. The streaming path already maps HTTP status codes in `sseStream.ts`.
- `clearStallTimer` / `resetStallTimer` in the cooking screen — two empty callbacks left over from the timeout-era stall detection, with no side effects and no dependents.
- Six unused constants in `src/constants/cooking.ts`.
- Four unused imports in the inventory screen.

## 2026-10-29 — First-launch onboarding & quick date reset

**Added**

- First-launch quick-record flow (`app/onboard.tsx`): three steps — preferred cuisines/flavours, allergies & dislikes, common pantry staples. Selections are written straight into the existing preference fields, and picked staples are appended to the inventory.
- `tastePreferences` on `UserPreferences`, fed into the Stage 1 prompt as `口味与菜系偏好：…`, and editable from the settings drawer.
- Per-row refresh button in the ingredient list: resets that ingredient's storage date to today in one tap.

**Changed**

- `SelectableChip` takes a `role` prop so multi-select groups are announced as checkboxes instead of radios.
- Users with an existing preferences blob are treated as already onboarded (no surprise redirect after updating).

## 2026-08-13 — Open-source readiness & state-management refactor

**Added**

- MIT license ([LICENSE](../LICENSE)) and README license section
- English README with architecture overview and quick start ([README](../README.md))
- Architecture document ([docs/ARCHITECTURE.md](./ARCHITECTURE.md))
- `MenuHistoryContext` — history screens now read uniformly from context instead of calling services directly

**Changed**

- Reworked AI recipe editing: modifications now **regenerate the full menu** via a streamed SSE call (thinking disabled) instead of applying partial patches — keeps nutrition, missing items and summary fields in sync
- Cleaned up AI prompts: removed bowl references, `bowlReferences` schema field and fragile bracket-pairing rules
- Made `menuProposal` the single source of truth for the cooking session (`prepSteps`/`cookingSteps`/`preciseNutrition` now live only on the menu)
- Unified history data flow: `handleStreamDone` builds the menu proposal once and reuses it in three places
- Migrated to a clean 3-stage progress model; removed the degraded `completedStageIndex` 3-state model — `status` is now the single progress source
- Removed the avatar settings menu shell (deferred until a backend exists)
- Fixed web inventory import (uses browser `fetch` where the native file APIs are unavailable)
- Translated all code comments to English; fixed remaining TypeScript errors (FlatList union type, chat-history role filter)

**Removed**

- Dead weighing/bowl stage code, duplicate components and legacy storage keys
- `recipeEditService` partial-patch logic (superseded by full-menu regeneration)

## 2026-06 → 2026-08 — Milestone history (pre-refactor)

The milestones below document the project's evolution before the state-management refactor, reconstructed from internal design records.

### Cooking flow: 5-stage → 3-stage

- Initial 5-stage flow (menu → weighing → bowl → prep → cooking)
- Unified the flow into a single swipeable Pager architecture, fixing double-navigation conflicts
- Removed the weighing and bowl stages — the AI now generates a complete recipe (dishes, nutrition, prep and cooking steps) in a single pass
- Redesigned step rendering with ingredient/amount tag parsing

### Features

- **Dietary memory** — remembers recently cooked dishes to avoid repetition
- **Recipe chat assistant** — floating chat ball in the cooking flow; ask questions or let the AI modify the recipe (with confirm/cancel)
- **Settings drawer** — API key / endpoint / model configuration, dietary restrictions, data import/export
- **Shopping list** — auto-detects missing ingredients and seasonings, persists checked state
- **Nutrition tracking** — per-dish and per-meal estimates with a draggable floating ball

### Fixes & polish

- Early bug-fix rounds (3-bug and 4-bug plans): nutrition sum, cooking-stage tag parsing, completion panel, history navigation
- State management root fix: 5 related bugs (stage guards, index mapping, pager mode, progress bar, migration)
- Unified progress bar + Pager refactor
- UI style overhaul, custom alerts replacing native `Alert`
- Prompt and UI optimizations; Stage 5 tag and navigation fixes
- Storage-date picker; history / floating-ball fixes; bottom-spacing and animation fixes

## 2026-06-09 — Initial release

- Initialized Expo + React Native + TypeScript project
- Fixed build artifacts and Hermes / build-properties configuration
