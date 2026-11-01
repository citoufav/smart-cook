# Changelog

All notable changes to this project are documented in this file.

The project is **pre-release** (v1.0.0). Early development history before 2026-08-13 is reconstructed from internal design records and grouped by milestone rather than exact dates.

## 2026-11-01 — Editing one amount rescales the whole dish, seasonings included

**Fixed**

- **Changing one ingredient's grams left the rest of the dish alone.** Editing rice from 50 g to 100 g kept water at 80 g and kept oil and salt untouched — the ingredients of one dish are locked in proportion (rice to water, dish to oil and salt), so this was plainly wrong. The `×½ / ×1.5 / ×2` chips did scale, but only ingredients, never seasonings, and they required the user to reach for them instead of just typing the number they wanted.

  The editor now has a 「按比例跟着变」 switch, **on by default**: editing one gram value scales every other ingredient and every seasoning by the same ratio. Turning it off restricts the edit to the item you touched, for "more tomato, same egg".

- Proportional scaling is applied when the field loses focus, not on each keystroke — typing `500` over `50` passes through `5`, which would have shrunk the whole dish to a tenth on the way. `handleSave` re-runs the same reconciliation before building edits, because tapping 保存 blurs the input and the state update from `onBlur` is not guaranteed to land before the save reads state.

**Added**

- Seasoning amounts are editable, and `set_seasoning_amount` rewrites the matching `[调料(Ng)]` tags in prep and cooking steps (and therefore the calories, since seasonings with a parseable gram amount count). Previously seasonings were read-only text, so salt could not be changed at all.

**Tests**: `set_seasoning_amount` (amount, step text, resulting calories) and `scaleGramAmount` (`80g`→`160g`, `10 克`→`15克`, `适量` and `1汤匙` returned unchanged) are covered by `npm run check:edits`.

## 2026-11-01 — One worked example instead of three scattered format rules

**Changed**

- The output format is now specified by **a single complete example menu** (`src/constants/menuFormatExample.ts`), shared by whole-menu and single-dish generation. Format rules used to be spread across the system prompt's field-format rules, the user prompt's schema skeleton, and two separate generation-rule blocks — the model had to synthesise the shape from three places, and the skeleton's `prepSteps` showed only one entry, so the most important convention (同一食材分属两道菜要各写各的) was never demonstrated.

  The example deliberately reuses 番茄 and 鸡蛋 across both dishes with different weights, which is exactly the case models collapse into one shared prep step. Placeholder skeletons (`"quantity": "克数（如200g）"`) were also teaching the model to write prose inside string fields; a filled-in example cannot be misread that way.

- Single-dish generation no longer carries a second, near-identical example. It references the shared one and restates only the three requirements that matter there: `name`, integer `estimatedWeight`, and `kcalPer100g` — with an explicit note that the two are different things and neither may be omitted.

- Dropped `preciseNutrition` from the requested schema. Nothing consumed it since calories became derived from grams, so it was pure output tokens and a second source of truth to disagree with.

**Tests**: `npm run check:edits` now parses the example itself and asserts it is valid JSON, that both dishes are named, that every ingredient carries a weight and a density, that the shared ingredient appears under two different dishes, that every step points at a real dish, and that each dish's stated calories match `Σ(grams × density ÷ 100)` within 5%. The example is the spec now — if it drifts, generation quality degrades silently and nothing in the UI would show it.

## 2026-11-01 — Loose numbers from the model are parsed, not silently zeroed

**Fixed**

- **A generated dish arriving with every ingredient at 0 g.** The model frequently writes `"estimatedWeight": "200g"` — a string — and `z.coerce.number('200g')` is `NaN`, which the fallback turned into `0`. The same mechanism had already eaten the dish `name` once. `src/utils/looseNumber.ts` (`readNumber` / `pickNumber`) now extracts the number from `200`, `"200g"`, `"约 200 克"`, `"290大卡"`, and returns `0` only for genuinely non-numeric text such as `"适量"`. Ingredient and seasoning objects are no longer field-coerced by zod at all — they are taken as `z.any()` and normalised explicitly, so a numeric field can never be silently replaced by `0` on the way in.

- The single-dish prompt now contains a **complete filled-in JSON example** instead of "same format as the schema above". Asking for a subset of a whole-menu schema confused the model; both observed failures (missing `name`, missing weights) happened on that path only. The prompt states three hard requirements — `name`, integer `estimatedWeight`, and `kcalPer100g` — and spells out that the latter two are different things and neither may be omitted.

- A dish whose ingredients are all 0 g is rejected with an actionable message rather than entering the menu, where it would put "buy 0 g" in the shopping list and never accumulate calories. The parse step also logs the model's actual shape when this happens.

**Tests**: the loose-number parsing is covered by `npm run check:edits`.

## 2026-11-01 — Calories are computed from grams, not asserted by the model

**Added**

- `DishIngredient.kcalPer100g` / `DishSeasoning.kcalPer100g` — energy density per 100 g, requested from the model for every ingredient and seasoning.

  **Per 100 g, not per gram or per kilogram.** The Chinese food composition table, nutrition labels, and USDA all publish per 100 g, and that is the form the model has seen in training — it is copying a number rather than converting one. Per gram yields small decimals (`1.43 kcal/g`) that models round badly; per kilogram requires multiplying by ten first. Every avoidable conversion is another chance to be wrong.

- `computeCalories` / `recomputeNutrition` / `hasFullDensity` in `menuEditService`. A dish's calories are now `Σ(grams × kcalPer100g ÷ 100)`, recomputed in a single pass after every edit and after the serving-count rescale. Seasonings count only when their `amount` parses as grams (`10g`, `约10ml`); "适量" and "1汤匙" are skipped rather than guessed, so the figure leans slightly low instead of inventing a number.

  Protein/fat/carbs are not computed independently — that would need three more densities per ingredient and multiply the output size. They scale with the calorie change so the four numbers stay mutually consistent. The estimate itself is ±20% anyway.

- 「整道菜按比例」 in the dish editor (`×½ / ×1.5 / ×2`) for "the portion was too small" — one tap scales every ingredient instead of retyping each. The editor also shows a live calorie readout while you type.

**Removed**

- `DishPlan.preciseNutrition`. Once calories are derived from grams there is only one correct number, and keeping the model's second opinion meant the nutrition panel could keep showing a stale value after an edit. `estimatedNutrition` is now the single source; the panel labels it 「精确」 only when every ingredient has a density.

**Fixed**

- A generated dish with no `name` was being dropped and surfaced as "AI 没有给出菜品" — technically correct but useless when the user asked for 油条 and the model simply forgot the key. `pickDishName` now accepts `dishName` / `title` / `菜名`, accepts a dish placed directly at the root without a `dishes` wrapper, and the drop warning logs the model's actual shape so the next occurrence is diagnosable. Both prompts now state that `name` is required.
- Serving-count rescaling also scales seasoning amounts (`10g` → `20g`); previously the oil stayed at 10 g while everything else doubled.

## 2026-11-01 — A dish is a module; the chat assistant stops editing

**Changed**

- **A dish is now self-contained.** `DishPlan` gained `id` and owns its own `prepSteps`, `cookingSteps` and nutrition. The menu-level `prepSteps`, `cookingSteps` and `preciseNutrition` arrays are gone.

  Before, one dish was spread across four parallel collections linked by different mechanisms: `dishes` (the object itself), `prepSteps`/`cookingSteps` (joined by `dishName` string), `preciseNutrition` (aligned by array index). Every add/remove/replace had to patch all four, and `preciseNutrition[3]` was the quiet failure mode — one off-by-one and calories land on the wrong dish while the totals still look right. Now adding a dish is `push`, removing is `filter`, and a dish can leave the menu and still exist on its own, which is the foundation the dish library needs.

  Old sessions are migrated on restore: menu-level steps are distributed back into their dishes by `dishName`, `preciseNutrition` moves onto each dish by index, ids are generated, and **already-completed prep/cooking checkmarks are preserved** — the migration is idempotent, so running it twice changes nothing.

- **The chat assistant no longer edits the recipe.** Deleting and changing a dish are deterministic operations that a button does better than a model. The `edit_menu` tool, the "allow recipe modification" switch, `RecipeChangeReview`, and the tool-call plumbing in `ChatSheet` are all removed.

  The assistant is now a pure Q&A helper (how to judge oil temperature, how to cut something), and its system prompt says so: when the user wants a change, it points at the dish's edit button. This removes a whole failure class — telling the assistant "add some milk" got interpreted as a new dish, and a nameless dish fell through as "未命名菜品".

- Adding a dish is the only AI-backed edit left. It lives behind「加一道菜」 on the menu page, generates exactly one dish, shows it for confirmation, then merges it.

**Added**

- Dish cards on the recipe overview page carry edit and delete actions. 「编辑」opens a sheet for the dish name, ingredient gram values, and adding/removing ingredients — step text is deliberately not hand-editable, because the `[ingredient(Ng)]` tags must stay consistent with the gram values and `applyEdits` already rewrites them.
- `rename_dish` edit operation; because steps now belong structurally to a dish rather than by name, a rename needs no other bookkeeping.
- Editing happens only on the recipe overview page. Prep and cooking pages are execution views — adding a dish halfway through prep would invalidate work already done.

**Fixed**

- `SettingsDrawer` had `['diet','skill','ai','data']` hardcoded as the expanded set, so 口味与菜系 was always collapsed while its neighbours were open. The set was also reset inside an effect that watched `preferences`, so changing any setting re-expanded everything. The collapse state now persists separately and defaults to all-open.
- `updatePreferences` merged onto a stale `state.preferences` snapshot, so two quick setting changes could overwrite each other. It now merges onto a synchronously-updated ref, and storage failures are logged instead of silently swallowed.
- A dish without a name used to be caught by zod as the string `'未命名菜品'` — which is truthy, so the "AI gave no dish" guard downstream never fired and a blank dish entered the menu. It now falls back to an empty string, nameless dishes are dropped, and an all-empty result reports "AI 没有给出菜品".

## 2026-10-30 — One copy of the menu records instead of two

**Removed**

- The menu-history copy: `menuHistoryService`, `MenuHistoryContext`, `app/history/` (list, detail, layout) and the `@v1:cooking:session:history` storage key.

  Menus were being stored twice — `cookingProgressService` kept the full session (surfaced on the cooking screen as in-progress / completed), and `menuHistoryService` kept a second snapshot underneath a separate history screen. Two copies of the same thing cannot stay in sync: editing a recipe updated the progress record but left the history snapshot stale, so the history screen showed a menu the user had already changed. Deleting one copy removes the failure mode structurally rather than adding a sync call that the next edit path would forget.

  The history screens had no entry point in the UI — nothing navigated to `/history` — so nothing is lost. The remaining record list on the cooking screen is the single source, and it is now updated when a recipe is edited.

**Known leftover**: the old `@v1:cooking:session:history` key is still sitting in AsyncStorage on existing installs. It is unreferenced and harmless; no migration was written for a single-user app.

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
