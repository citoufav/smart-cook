# Changelog

All notable changes to this project are documented in this file.

The project is **pre-release** (v1.0.0). Early development history before 2026-08-13 is reconstructed from internal design records and grouped by milestone rather than exact dates.

**Debug switch — 每次启动都显示引导.** At the bottom of 设置 → 数据管理 there is now a toggle that makes the app enter onboarding on every launch instead of only the first. Needed because the flow can otherwise only be tested once per install (clear data to see it again), which is a miserable loop when iterating on copy and layout.

  Turning it on does not stick in the shipped build — the persisted flag defaults to `false`, and the guard is a per-launch ref so finishing onboarding never bounces the user straight back into it.

## 2026-11-01 — CI on every push

**Added** — GitHub Actions runs `npm run typecheck` and `npm run check` (all seven self-check scripts) on every push to `master` and on pull requests, Node 24 with a cached `npm ci`. README carries the badge.

**Why Node 24** — the check scripts import `.ts` files directly and depend on Node's type stripping; 20 and 22 need a flag for that.

**Not added** — eslint is left out of CI on purpose: the repo has pre-existing `react-hooks/exhaustive-deps` warnings that would have to be cleaned up first, and a red badge over cosmetic warnings teaches you to ignore it.

## 2026-11-01 — 拍照识别食材

**Added** — the ＋ button on 库存 now opens a sheet with two choices: 拍照识别 and 手动输入. A photo goes to the model, which answers with a JSON list of ingredient names; the list lands in a confirm sheet where each name can be edited or deleted before 「加入库存」 writes them.

**Why the two-step.** A wrong name is invisible once it is in the inventory — 老抽 recognised as 可乐 sits there for weeks. Weights are always left empty: a photo cannot show grams, and a made-up number poisons every later "how much to use" calculation.

**Ingredients and seasonings are classified.** The model tags every item `kind: ingredient | seasoning`, the confirm sheet shows two groups, and each row has a tappable 食材/调料 chip to fix a misjudgement; saving writes to `ingredientService` and `seasoningService` separately (seasonings default to 够). Anything without a usable `kind` counts as an ingredient — a seasoning filed under 食材 is one tap to move, while an ingredient filed under 调料 silently disappears from the 主料 list the AI gets.

**API note.** DeepSeek's `deepseek-flash` does take images, inline as a base64 `image_url` block (no Files API, no second key, one request). `buildChatBody` now maps a protocol-neutral block array to each protocol's own shape — `image_url` for OpenAI-compatible, `image` + `source.base64` for Anthropic — and drops any block whose data URL cannot be parsed instead of sending a malformed request. `check:vision` pins the parsing rules: fences, small talk before the JSON, 「五花肉（约500g）」 cleanup, dedupe, caps, and the two protocol shapes.

**Deliberately not done** — no floating action bubbles (pure animation for a smaller tap target; the sheet already has room for the confirm list), no gallery picker, no batch of multiple photos, no re-run on a single item, and nothing about the photo is stored.

## 2026-11-01 — 库存档案可以删了

**Added** — each profile row in 库存档案 carries a 🗑 when there is more than one profile. Deleting asks first, because it takes that profile's inventory with it.

**Deliberately not done** — the last profile cannot be deleted: the profile list has to point at something, and an empty pointer means the whole inventory reads back blank. Deleting the current profile switches to the first one left rather than landing the user in a broken screen.

## 2026-11-01 — Dead code removal

**Removed** — `src/hooks/useSafeJsonParam.ts` (whole file), `findConditionByRule` from `healthConditions.ts`, and five unused validators from `src/utils/validation.ts` (only `validateApiKey` survives; the rest of the file's checks are inlined in the sheets that use them).

**Why.** Deletion is the only refactor that cannot introduce a bug, and the safety net here is the six `check:*` scripts, which cover pure logic only — any change to a component is unprotected. Everything larger was left alone on purpose: `DishSheets.tsx` at ~1000 lines is three sheets sharing one shell (a module, not a god component), and `cooking.tsx` is one screen.

**Left for later** — `detectLoop` in `app/(tabs)/cooking.tsx` is the only guesswork in the codebase with no test, and it is now marked with a `ponytail:` comment: extract it to `src/utils/loopDetect.ts` and add it to the check scripts the next time the generation flow is touched, not as a standalone refactor.

## 2026-11-01 — 存放方式：常温 / 冷藏 / 冷冻

**Added** — every ingredient row on 库存 carries a small pill (常温 / 冷藏 / 冷冻) before the ↻ and 🗑 icons. Tap to cycle; the state is stored per ingredient. Tapping it does not reset 入库日期.

**Why.** It feeds two things at once. Shelf life is now multiplied by storage (常温 ×0.6, 冷藏 ×1, 冷冻 ×15, floored at 1 day), so 猪肉 stored 3 days at 常温 warns while the same age in 冷冻 does not — "everything is refrigerated" was the weakest assumption in the warning. And the AI prompt now reads 「已存放3天，冷冻」, which is the difference between a recipe that says 提前解冻 and one that gives a 20-minute path for a frozen block of meat.

**Deliberately not done** — switching storage does not restart the day counter (the date means "when it was bought", not "how long since it left the freezer"), and the add/edit form has no storage picker; the pill is the only control, one tap per change.

**Unchanged** — the warning warns and stops: never blocks the menu, never says 还能吃. 冷冻 ×15 is an early-warning multiplier, not a claim that meat keeps 45 days.

## 2026-11-01 — Stale ingredients get a warning, computed locally

**Added** — the recipe page now opens with 「⏳ 这些食材放得有点久了」 listing the ingredients whose stored age has passed a shelf-life limit: 猪肉 5 天、虾仁 9 天 → both listed with how long they usually keep, then a line saying to look and smell before cooking.

**Why not ask the model.** The suggestion was to have the AI "scan the inventory and flag anything that might expire". It already receives 「已存放 N 天」 for every ingredient, so it is not blind to this — but a judgement call inside a language model has three problems here: the same inventory can be judged differently on two runs, the user cannot check the reasoning, and there is no way to unit-test it. Age plus food type is a table lookup, so it is a table lookup. `src/utils/shelfLife.ts` holds the shelf lives and `findAgingIngredients`; `check:meal` pins the boundaries and the sort order.

**Safety boundary** — the table assumes refrigeration (the longer case) and every string says 可能 / 放得有点久, never "还能吃". The card warns and stops there; it never blocks the menu, and it never reassures. Deciding whether food is still good is the user's job and the only responsible split. (Storage is now a stored field — see the 存放方式 entry above, which replaces the assumption with ×0.6 / ×1 / ×15.)

The AI prompt is untouched by this change: it decides the menu, this decides whether the user gets a nudge.

**Removed from the UI** — the 「每次启动都显示引导」 debug switch is gone from 设置 → 数据管理. The preference and the redirect guard stay, so re-testing onboarding is one line in `settingsService` (or flipping the stored flag); a shipped app should not show a toggle whose only purpose is to trap you in the setup flow.

## 2026-11-01 — Two taps that deleted data now ask first

**Added — confirmation before un-ticking a saved tag.** The drawer's chip rows remove on tap, which was fine as an interaction but wrong as a consequence: one stray tap deletes a saved preference, and nothing on screen tells you it happened. Only in 只显示已保存 mode (`onlySelected`) does it ask — in onboarding, tapping a chip is just turning off an unsaved choice, and interrogating people mid-selection would be obnoxious.

**Added — confirmation before resetting an ingredient's storage date.** The ↻ button on 库存 rewrites `createDate` to now so "已存 N 天" restarts. It was one tap with a toast afterwards, which is backwards: the toast reports the damage after the fact. Now 「重置入库时间？」 explains what will change, then a toast confirms it happened.

## 2026-11-01 — 口味与菜系 split back into two visible groups

**Changed** — the saved-tag row was a single blob: 家常菜 sat next to 香辣 with no way to tell which was which. 口味与菜系 now renders 菜系 / 口味 as separate labelled groups, plus 「其他」 when a custom tag does not belong to either.

  Storage did not change: `tastePreferences` is still one array, and the prompt still reads it as one line. The split is a display concern, resolved by looking each saved tag up in the preset tables (`classifyTasteTag`). Custom tags deliberately do **not** get pushed into one side — guessing wrong puts 咖喱 under 菜系 and the user has no way to fix it; a third group is honest about not knowing.

  Adding from either group appends to the shared array and re-classifies on the next render; the other group's tags are carried through untouched, so one group's edit cannot delete another's entries.

## 2026-11-01 — Two layout fixes from looking at the actual screens

**Fixed — section headers were touching their content.** In the settings drawer the header's `borderBottom` is the divider, and the expanded content began immediately below it, so the first line of every section was pinned against the rule. `marginBottom` on the header is the fix — padding alone cannot do it, because the border is drawn at the padding edge.

**Fixed — a lone card in the last row stretched to full width.** 我的菜 uses a two-column `FlatList` and the card had `flex: 1`, so an odd number of dishes made the final card fill the whole row — same height, double width, looking like a rendering bug. The card width is now computed once from the screen width minus the list padding and the column gap, so every card is exactly half. Fixed width beats letting items negotiate, here specifically because there is nothing to negotiate with in a row of one.

## 2026-11-01 — Health conditions become their own list, with a "+" of their own

**Changed — `healthConditions` is a separate preference.** They used to be written into `dietaryRestrictions` as pre-formatted sentences. That worked, but it made every condition a 忌口 entry: 「有没有别的忌口」的标签行里会出现一条「糖尿病：控糖、少精制碳水、低GI」，而这一行本来是回答「不吃什么」的。

  Now the drawer keeps them apart: `dietaryRestrictions` answers 不吃 X, `healthConditions` answers 有 X 病。The folded block gets its own ＋, so a condition the presets do not cover (肾病, 甲状腺) can be added like any other tag — and it appears right where it was added, not up in the 忌口 list.

  At prompt time the two are rendered differently on purpose: 忌口 is one line of items, health conditions become 「健康约束：…」 with the note *these are long-term, not "not in the mood for it today"*. A preset expands to its written rule (糖尿病 → 控糖、少精制碳水、低GI); anything the user typed themselves is passed through verbatim, because they know their own condition better than a table does.

**Migration**: conditions saved by the previous build sit in `dietaryRestrictions` as long sentence strings. They still read as 忌口 entries and still reach the model, so nothing breaks — they just live in the other list. Not worth a migration for a feature that shipped an hour earlier.

**Tests**: `check:ai` asserts the preset table still writes 「标签：做法」, that a preset expands to its rule, that a user-typed 肾病 survives, and that an empty selection produces no prompt line at all.

## 2026-11-01 — Settings reordered, health conditions folded away, and a data-loss bug I caused

**Fixed — onboarding wiped existing preferences.** `finish()` wrote `tastePreferences` and `dietaryRestrictions` from its own selection state unconditionally. On a *re-run* (the debug switch, or pressing 跳过 from step 1) those arrays are empty, so finishing wrote empty arrays over whatever was already stored. Anyone who had set preferences and then walked the onboarding again lost them.

  The guard is now: if nothing was picked, keep the stored values. Clearing them is done in settings by unticking, not by "select nothing and finish". The trade is deliberate — "I didn't touch this step" and "I want this empty" look identical from the array, and losing data is the worse failure.

**Changed — section order**: 口味与菜系 moved to the top (it is the thing people actually adjust), 忌口设置 second, then 熟练度 / 模型与 API / 数据管理. `SECTION_KEYS` is the order, so the persisted expand/collapse state followed automatically.

**Changed — 忌口 and 口味 show only what is saved.** First attempt at this put the full preset table into the drawer (15 cuisines + 13 flavours as selectable chips), which turns a settings panel into a picker sheet and buries the two things the panel is for: seeing what is currently set, and removing what is not wanted.

  So `TagChipGroup` grew `onlySelected`: the drawer renders just the saved tags (tap to remove) plus ＋ for a new one; the preset grid exists only in onboarding, where picking for the first time is the whole task. The empty state says 「还没有，点右边＋添加」 rather than showing a wall of options.

  The presets themselves still live in `src/constants/dietaryOptions.ts` and are shared, so onboarding and any future picker stay in sync — the drawer just does not draw them.

**Changed — 忌口 and 口味 are now chip rows.** The old control was a permanent input + 添加 button + removable tags, which is a form; the input now only appears after ＋ is pressed.

  The drawer shows 菜系 + 口味 as one list and 过敏 + 忌口 as one list, because that is how they are stored (`tastePreferences`, `dietaryRestrictions`) — one group, one array, so the cross-group leak fixed earlier cannot happen here.

**Changed — 长期疾病 is collapsed.** It sits behind 「▸ 有长期疾病或特殊饮食方式？」 inside 忌口设置, closed by default. Listing 糖尿病 / 痛风 as a row of buttons in a settings drawer is both long and a little tactless for everyone who does not need it.

**Also**: the onboarding chip group became `TagChipGroup`, shared by both screens; `DietaryTagInput` was deleted.

## 2026-11-01 — "完成做菜" only exists on the last page

**Fixed** — all three pager pages shared one green 完成做菜 button, so the recipe overview offered to finish a cook that had not started. A user who pressed it there never discovered that 备菜 and 炒制 existed at all: the app happily filed the menu away as done, every time.

  The footer now follows the page: 菜谱 and 备菜 show an orange 下一步 that advances one page, and only 炒制 shows 完成做菜. Same height, so the floating balls keep their offset.

**Also fixed while wiring it**: `goToPage` sets `currentPage` and dispatches the stage itself instead of relying on `onMomentumScrollEnd` to notice the programmatic scroll. Pressing 下一步 twice in quick succession would otherwise leave the state behind the scroll position — the second press would move the same single page again.

## 2026-11-01 — Onboarding ends by cooking, not by a settings screen

**Changed** — the last onboarding step's button no longer says 完成. With an API key configured it says 「立即生成午餐（1 人份 · 700 大卡）」 and actually starts a generation: the preferences are written, the pantry is saved, and the app routes to the cooking tab with `autoGenerate=1&people=1&meal=lunch&calorie=700`, where the screen waits for its saved defaults to load, applies the overrides, and submits once (guarded by a ref so it cannot loop).

  The whole point of the onboarding is that the user has just told the app what they like and what is in their kitchen. Asking them to then walk to another tab and press a similar-looking button is where a first session dies.

  Without a key the button stays 完成 and goes to the inventory tab — offering 立即生成 when generation is certain to fail would be worse than not offering it.

**Meal inference**: 05–10 早餐 300 / 10–15 午餐 700 / 15–21 晚餐 500 / 21–05 早餐 300. Note this deliberately does *not* follow the "after 17:00 it's breakfast" rule from the request — recommending breakfast at 6pm is the kind of thing that makes an app feel broken. The boundary is one table in `src/utils/mealTime.ts` if it needs moving.

**Tests**: `npm run check:meal` pins 12 instants, one either side of each boundary (9:59 breakfast, 10:00 lunch, 14:59 lunch, 15:00 dinner, 20:59 dinner, 21:00 breakfast), plus the calorie assigned to each.

## 2026-11-01 — The pantry step gains seasonings, and the ingredient list nearly doubles

**Added** — 家里现在有什么 used to be 16 ingredients only. It is now 29 ingredients plus a second group of 14 common seasonings (食用油 / 盐 / 生抽 / 白糖 / 淀粉 …). Selected seasonings are written straight into the seasoning inventory with status 充足, since ticking one means "I have this in the cupboard" — quantity can come later. Both groups get the same **＋** as the earlier steps.

  Ingredients are ordered 蔬菜 → 蛋白 → 主食 → 葱姜蒜 rather than alphabetically, so a person scanning for 土豆 or 鸡蛋 finds the cluster they expect instead of reading all 29.

  Seasonings matter more than they look: the shopping list and the "调料库存不足" warnings are driven entirely by this data. Skipping this step is why a brand-new install used to be told to buy salt and oil.

## 2026-11-01 — Four chip groups, four sets of state (a regression I caused)

**Fixed** — picking 西北菜 under 偏爱菜系 made it appear under 口味倾向 too, and picking 芒果 under 过敏 made it appear under 忌口. Screenshot-obvious, shipped for one turn.

**Root cause**: onboarding kept one array for 菜系 + 口味 (`taste`) and another for 过敏 + 忌口 (`avoid`), which was harmless while each group only rendered its own preset list. The 「＋」 feature needs to render *selected values that are not presets* — `selected.filter(s => !items.includes(s))` — and that filter cannot tell which group a value came from. Hence the leak.

**Fix**: four arrays, merged only at save time (`[...new Set([...cuisines, ...flavors])]`). The stored shape is unchanged — `tastePreferences` and `dietaryRestrictions` are still the two flat lists the prompts read — so this is purely a UI-state correction.

  Worth noting the general shape of the mistake: adding a feature that *displays* existing state exposed a hidden assumption (one array = one group). The filter was correct; the state model was not.

## 2026-11-01 — Onboarding chip lists grow, and every group takes a "+"

**Added** — the first-run 口味 and 忌口 steps had 8 and 6 presets; they now carry 15 cuisines, 13 flavours, 12 allergens and 12 avoidances. Every group also ends with a dashed **＋** that opens an inline field (20 chars, Enter or 加上 to commit).

  The custom value lives in the same `selected` array as the presets, so the chip list renders `[...presets, ...selected-minus-presets]` — a custom entry appears selected without a second source of truth to keep in sync, and it can be toggled off like any other chip.

  Keyboard handling came along for free-ish: the add field lives inside a child component, which would have meant passing a `RefObject` with a types stand-off, so `useKeyboardAwareScroll` gained `captureNode(node)` — the child hands up its node on focus instead of its ref, and the parent scrolls it above the keyboard.

## 2026-11-01 — Health conditions store a sentence, not a diagnosis

**Added** — 设置 → 忌口设置 grew a row of presets: 糖尿病 / 高血压 / 高血脂 / 痛风 / 胃病 / 孕期 / 素食. Tapping one appends a line to the existing 忌口 tags; tapping again removes it.

**The decision that matters is what gets stored.** Not `糖尿病`, but `糖尿病：控糖、少精制碳水、低GI`. If only the disease name reached the prompt, the model would do the obvious thing (put less sugar in) and miss the point (control total carbohydrate). A one-word diagnosis is an invitation to improvise; a written constraint is not.

  This also kept the change small: 忌口 already flows into both the menu prompt and the single-dish prompt, so nothing downstream had to change — no new preference field, no new prompt section, no extra plumbing. What the user sees in the tag list is exactly what the AI reads, and they can edit or delete it like any other tag.

**Safety boundary**: the row carries 「只是让 AI 避开相应的食材和做法，不能代替医生或营养师的建议。」 A cooking app that implies medical authority is worse than one that does not list the feature at all. The rules stay conservative on purpose — no doses, no claims; 肾病 was left out because a wrong rule there is genuinely harmful.

**Not in onboarding.** It is a set-once setting, and the first-run flow is already the longest part of the app. If it ever moves there, it is one more `ChipGroup`.

**Tests**: `npm run check:ai` asserts the preset shape — every rule is written as 「标签：做法」, the diabetes rule actually says 控糖, and a user's own tag like 不吃香菜 is not mistaken for a preset.

## 2026-11-01 — The key page now serves two kinds of user instead of half-serving one

**Rewritten — the first-run key step.** It had three bullet points that skipped the two hardest parts (where to top up, where the API key page even is). It now spells out the actual five steps a person has to do, in order, each with a bold lead-in: 注册 → 充值 → 找到 API keys（左上角菜单） → 创建 → 复制粘贴. "全程大约 5 分钟" is stated up front so the page does not feel open-ended.

**Added — a second path, for people who already know.** Below the beginner walkthrough, separated by a rule, is 「已经习惯自己配 API？」: skip this step, go to 设置 → 模型与 API, pick OpenAI 兼容 or Anthropic 兼容, fill in your own base URL and model. It carries a tappable 「打开模型与 API 设置 ›」 shortcut so that audience does not have to hunt through the drawer.

  The two audiences are genuinely different. One needs the beginner steps written out as if they have never configured an API; the other needs a link and to be left alone. Previously the page was written for neither — vague enough to lose beginners, verbose enough to annoy experts.

**Kept deliberately**: the step is still skippable, and the note still says what happens without a key (generation fails). Blocking the door is a worse greeting than letting someone look around.

## 2026-11-01 — First run now asks for the API key, with a button that goes and gets one

**Added — the key step is the first thing onboarding shows.** It used to go straight to 「你爱吃什么？」 and leave the key as an unmentioned prerequisite somewhere in settings. Four steps now: 配 Key → 口味 → 忌口 → 常备食材.

  The page explains in three numbered lines what to do (open the site, create the key, paste it back), and the primary button opens `platform.deepseek.com/api_keys` directly. The key field is right there, so the flow never requires finding the settings drawer. A key pasted but then abandoned with 跳过/完成 is still saved — losing it because someone changed their mind about the remaining steps would be its own small betrayal.

  Still skippable: the note says the key can be added later from settings, and that generation will fail without one. Blocking a curious user at the door is worse than letting them look around first.

**Removed** the DeepSeek hint line in settings — now that onboarding explains it, repeating it in the drawer is noise. Only the OpenAI/Anthropic-compatible presets still carry a hint, and those are aimed at people who want details.

## 2026-11-01 — Fewer dials: model and thinking are no longer choices

**Removed.** The DeepSeek section had a model dropdown (flash / v4-pro), a thinking on/off switch, a three-way effort picker, and an API-address field. All four are gone. Menu generation is now always `deepseek-flash` with high-effort thinking, and the settings panel for DeepSeek is exactly one input: API Key.

  The reasoning: a beginner cannot tell what went wrong when the output is bad, so every dial they can turn is a way to be stuck in a state they did not intend and cannot diagnose. A mistyped base URL produces a 404, which is completely opaque to someone who has never configured an API. `aiEndpoint` and `aiModel` therefore ignore `prefs.apiUrl` / `prefs.modelName` for the DeepSeek preset — hard-coded, so no stale value from an older install can wedge it either.

  Address and model fields remain on the 「OpenAI 兼容」 and 「Anthropic 兼容」 presets, which is where anyone who wants to tinker belongs.

**What changed underneath**: `aiBody` no longer reads `prefs.thinkingEnabled` or `prefs.reasoningEffort` for menu generation — it forces thinking on with effort `high`. This is deliberate rather than careless: existing installs have `thinkingEnabled: false` stored from the old default, and with the switch removed there would be no way to turn it back on, so reading the flag would permanently deny those users the new default.

  `thinkingEnabled` / `reasoningEffort` stay in `UserPreferences` (dropping them means a storage migration for no user-visible gain, and they are the obvious place to hang an advanced toggle if one ever comes back). Nothing reads them today.

**Escape hatch**: anybody who wants `deepseek-v4-pro` selects 「OpenAI 兼容」, points the URL at `api.deepseek.com`, and types the model name. The comment in the drawer says exactly that.

**Also**: the loading overlay's "AI 深度思考中…" panel now follows `aiSupportsThinking(prefs)` instead of the dead preference — otherwise an OpenAI-compatible provider that does not think would show a permanently empty thinking box.

## 2026-11-01 — Two protocols instead of a vendor list

**Changed — one DeepSeek, one OpenAI-compatible, one Anthropic-compatible.** The dropdown had grown to seven vendors, which meant maintaining seven sets of base URLs and default model names that drift out of date. Almost every provider offers one of two compatibility endpoints, so the list shrank to: DeepSeek (official), OpenAI 兼容, Anthropic 兼容.

  Both non-DeepSeek entries are really "a protocol plus a base URL plus a model name". Point 通义/Kimi/智谱/Ollama at the OpenAI 兼容 slot; point anything Anthropic-shaped (including DeepSeek's own `/anthropic` endpoint) at the other.

**Added — an actual Anthropic adapter.** Offering the option without the protocol would have been a broken menu item, so it is implemented rather than listed.

  - `POST /v1/messages` instead of `/chat/completions`; `x-api-key` + `anthropic-version: 2023-06-01` instead of `Authorization: Bearer`.
  - `system` moves to the top level and is stripped out of `messages` (Anthropic rejects a system role inside the array; multiple system messages are joined).
  - No `response_format: json_object` — Anthropic has no such parameter, and sending it is a 400. JSON is enforced by the prompt instead, which the prompts already did.
  - Thinking is `thinking.budget_tokens` (mapped from the effort setting, clamped below `max_tokens`), not `thinking.type`.
  - The SSE parser gained a second branch: `content_block_delta` with `text_delta`/`thinking_delta`, and `message_delta.stop_reason === 'max_tokens'` mapped to our `'length'` so truncation is still reported.

**Fixed — `thinking` was being sent to every provider.** Both `thinking` and `reasoning_effort` are DeepSeek fields. They were going out regardless of which vendor was selected, and an unknown parameter is a 400 on some services. Now only DeepSeek (and Anthropic, in its own shape) receives them.

**Structure**: `src/utils/aiRequest.ts` holds the protocol difference as a pure function, `services/aiClient.ts` resolves protocol/endpoint/headers/model and delegates, and the three call sites just pass messages + limits + a `thinking: 'auto' | 'off'` intent. Adding a vendor is one line in `constants/aiProviders.ts`.

**Tests**: `npm run check:ai` asserts the body shapes for both protocols — system placement, `response_format` present/absent, thinking fields only where they belong, and the Anthropic budget staying under `max_tokens`. This is the one part that cannot be verified against a live API from here.

**Still unverified**: no real Anthropic request has been made (no key on this machine). The request shape and stream parsing follow the documented protocol, but the first live call should be watched closely.

## 2026-11-01 — Inventory profiles, and a backup that carries everything

**Added — 库存档案**

- 「家里」「单位」各存一套库存。The switcher lives top-right on all three tabs; the default install has exactly one profile called 家里, and new ones are created from the bottom of that sheet. Everything else — 我的菜, completed menus, 最近吃过, taste settings — stays shared, because a recipe is a memory that belongs to *you*, not to a kitchen.

-  Storage moved from one global pair of keys to per-profile ones (`@v1:inventory:<profileId>:ingredients`). The profile list and the current id live in a single key so they can never disagree with each other.

-  **The migration order is deliberate**: write the new per-profile keys, read them back to verify, and only then write the pointer. If anything fails in between, the pointer is never written and the next launch retries; the old keys are read once and never deleted. If verification fails, the pointer is still written (the app would otherwise be unusable) but not one byte of the old data is touched.

-  `HeaderBar` gained a `right` slot. The title became absolutely positioned and centred so a chip on the right can't shove 随煮 off-centre.

**Changed — 备份 v2**

- 导出/导入现在一次带走**所有档案的库存 + 我的菜 + 菜单记录 + 最近吃过**，文件格式升到 v2（`format: "suizhu-backup"`）。API Key 永不导出，口味设置不导出（重设三下点击，而导入覆盖当前设置会让人莫名其妙）。老 v1 文件（顶层直接是 `ingredients`/`seasonings`）继续认，按老规则并进当前档案 —— 不能让别人手上的旧备份变成废纸。

- **导入只增不改**：同名库存跳过、同 id 菜品跳过、同 id 菜单记录跳过。误选一个旧文件、或者别人发来一个乱七八糟的包，最坏结果是多几条没用的数据，而不是把你现在的配方冲掉。

**Security, such as it is.** There is no remote attacker here — no backend, no account, and the file has to be picked by hand in the system picker. The three things that actually matter:

  1. **Every imported object is rebuilt field by field from a whitelist**, never spread into state. `JSON.parse` alone won't pollute a prototype, but one deep merge later will, and this is the only real defence.
  2. **Size cap** (20 MB, plus a 5000-item cap per array). A 500 MB JSON would take the app down through sheer length; the read now refuses before parsing.
  3. **Prompt injection** is the interesting one: imported dish and ingredient names end up inside AI prompts. Someone can name an ingredient "ignore all previous instructions". Today the worst case is odd output from *your own* AI call — no data leaves the device — but the rule to keep is that strings from a file are data, never instructions.

Not doing: encryption or signatures. A password on a backup you might forget is a way to destroy your own data, and this isn't key material.

**Tests**: `npm run check:backup` covers the format (whitelist rebuild dropping unknown fields, bad JSON, foreign files, future versions, the size cap), v1 compatibility, a `__proto__` payload not polluting `Object.prototype`, and all four merge rules (skip-same-name, skip-same-id, newest-first ordering, the 10-entry diet-memory cap).

## 2026-11-01 — Reuse: the AI decides each dish's multiplier, not the person ratio

**Added**

- 「复用做过的菜」on the cooking screen: tick any number of saved dishes, and generation sends their recipes to the model instead of asking it to invent the whole menu again. One call returns `reused: [{ name, scale }]` plus only the dishes that are still missing (possibly none).

- `prepareReusedDishes` in `src/services/menuEditService.ts` — scales each saved dish by its own multiplier, and re-checks `isInInventory` against the *current* inventory before the shopping list is rebuilt.

- `scaleDish(dish, factor)` extracted from the person-count path so both callers share one implementation (grams in ingredients, amounts on seasonings, and the gram figures inside step text all move together).

**Why not just multiply by the person ratio.** Three people eating one dish is not one dish made three times larger. A home wok will not hold 450 g of shredded pork — it stops stir-frying and starts boiling. Real cooking answers this by adding *another* dish. So the model is given the chosen recipes as input and asked to decide two things: a per-dish multiplier, and whether anything else is needed. 炒菜 stays near 1.5×, soup can go further, rice scales with people.

**No bounds in the prompt.** The user's instruction was explicit: *"不设置什么区间上限吧，让AI自己决定吧……设置上限反而限制了AI发挥，限制主要是防止输出不合理得意外值，这个单独考虑吧，不要在生成的时候加这种限制了。"* Multipliers and dish counts are unconstrained at generation time. `sanitizeScale` handles only obvious accidents — non-numeric, negative, or above 10× (usually grams pasted into a ratio field) fall back to the person ratio. Likewise the picker has no selection cap: ticking a whole table of dishes is a legitimate "no new dishes today".

**The shopping list does not trust the model.** A saved dish carries the `isInInventory` flags from the day it was cooked; by the time it is reused those are stale, so flags are recomputed from current inventory and `applyEdits` regenerates `missingItems` from the final grams.

**Staples stay out of the library.** `isStapleDish` filters 米饭/馒头/面条/稀粥 and friends out of both 我的菜 and 最近吃过, and out of the AI's "avoid repeating these" hint. Rule 6 of the system prompt still requires staples to be part of a *menu* (they carry calories and a cooking step), but they are not dishes you would want to re-cook from a card. Older entries already saved self-heal on the next write.

**Tests**: `npm run check:edits` gained a reuse group — per-dish multiplier applied, step text scaled with the grams, missing multiplier falling back to the person ratio, a `"1.5"` string being accepted, a `300` multiplier being rejected as an accident, `isCompleted` reset on reused steps, stale inventory flags refreshed, and a merged menu's total calories and shopping list recomputed from final grams. `npm run check:dishes` gained the staple table (24 names) and the self-healing filter.

**Also added — a multiplier on the dish card.** Opening a saved dish now has 「这次做多少」 (×0.5 / 原份量 / ×1.5 / ×2 / ×3). The grams, the seasoning amounts, the gram figures inside the prep and cooking steps, and the calorie figure all rescale together, purely locally via `scaleDish`.

  Scaling **does not write back by itself** — wanting to cook one dish at 1.5× tonight does not mean your saved recipe is now 1.5×. So a 「保存这份用量」 button appears *only while the multiplier is off 1×*, and it asks for confirmation before overwriting, because the library only ever keeps the latest version. Nothing is written unless that button is pressed: leaving the screen restores the stored recipe.

  Scaling always starts from the stored dish, never from the previous scaled result, or every tap would compound.

**Also fixed — 清水 was on the shopping list.** The local check treated `isInInventory === false` as "you need to buy this", and water is never in anyone's ingredient inventory, so it was always flagged. `isAlwaysAvailable` is now an exact-name whitelist for tap water and its synonyms (水/清水/开水/凉白开/纯净水…), skipped when the shopping list is rebuilt and when the 需购买 tag is drawn. It is exact-match on purpose: 水淀粉 is starch and 矿泉水 is a product, and both must still be listed.

## 2026-11-01 — The dish library: a dish is identified by its name, not by an instance id

**Added**

- `SavedDish` and the dish library. Completing a cook splits the menu into individual dishes and files each one away; a third tab 「我的菜」 lists them as cards (name, calories, how many times cooked, when last), and tapping one opens an ingredient list plus its prep and cooking steps, with a delete action.

- `normalizeDishName` / `mergeDishIntoLibrary` in `src/utils/dishLibrary.ts` — pure, so the rules are covered by `npm run check:dishes`.

**The identity question.** A generated dish already carries a unique `DishPlan.id` (timestamp + random), so every instance is distinguishable. The library deliberately does **not** use it: a dish's identity is its normalised name.

  - 米饭 appearing in ten different menus is one saved dish with `timesCooked: 10`, not ten entries. That is the entire point of a library — you look for a dish, not for an occasion.
  - Two identically-named dishes in the *same* menu count once, or a single cook would double the counter.
  - Normalisation only merges genuine spelling variants: outer whitespace, runs of whitespace, full-width spaces, full-width parentheses. It deliberately does **not** fuzzy-match: 麻婆豆腐 and 麻婆豆腐（不辣版） are different dishes, and merging them would be wrong.
  - The tradeoff is that a recipe is overwritten rather than versioned — the library always holds the most recent version of how you cooked it.

- `basePersonCount` is recorded at the moment of saving. Without it, a stored "200 g" is meaningless — you cannot tell whether it was for two people or four, and therefore cannot rescale it when a dish is reused.

- Entries are filed when the cook **finishes**, not when the menu is generated — otherwise "做过 N 次" would actually mean "generated N times".

- Capacity is 200 dishes; when full, the least-recently-cooked is dropped.

**Tests**: `npm run check:dishes` covers normalisation (including the 麻婆豆腐 / 不辣版 non-merge), first save, repeat save (counter increments, `createdAt` preserved, content replaced, `basePersonCount` updated), duplicate names within one menu, ordering by recency, empty names being skipped, and eviction at the cap.

## 2026-11-01 — Colour table gets a character-level fallback, and why not embeddings

**Added**

- `CHARACTER_HINTS`: when no whole keyword matches, the ingredient name is scanned for semantic morphemes — 菜/苗/笋/瓜/芽 → green, 肉/腩/腱/排/菇/菌 → brown, 鱼 → teal, 虾/蟹 → pink, 蛋/油 → yellow, 奶/酪 → blue, 米/面/薯/藕 → neutral, 豆 → bean-green.

  A finite table against an open-ended ingredient vocabulary was the obvious objection: 鸡毛菜, 牛腩, 芝麻油 are not in the list. But Chinese ingredient names carry their category in the characters, so a second pass over morphemes covers "not in the table but guessable from the name" for far less data than enumerating names. Whole words are still matched first and by longest match, so 番茄酱 beats 番茄 and 豆角 beats 豆.

- A handful of common gaps filled in the whole-word table: cooking oils, potatoes/yam/lotus root, noodles/bread/pasta.

**Rejected — embeddings for colour.** The suggestion was to run a vector model and assign hues from the vector. Three reasons not to: (1) an embedding tells you ingredients are *similar*, not *what colour they should be* — turning a vector into a hue still needs an arbitrary mapping, so it solves a problem the app does not have; (2) similar hues are the opposite of what a reader wants within one dish, where the whole point is telling ingredients apart, and the per-menu assignment already guarantees that; (3) shipping or calling a model to pick a background tint is disproportionate to a cosmetic concern, and it would add another provider/key to an app that talks to exactly one API.

  Anything genuinely unrecognised still gets a valid, distinct, non-colliding colour via the golden-angle fallback. The table is a *hint layer*, not a classifier — degrading to "clean but arbitrary" is acceptable; degrading to "missing" or "colliding" would not be.

**Tests**: 鸡毛菜 → green, 牛腩 → brown, 芝麻油 → yellow (all pure character fallback), 小油菜 still green via whole word, and an unrecognised name still returns a valid `hsl()` pair.

## 2026-11-01 — Ingredient tags take the colour the ingredient actually has

**Changed**

- Tags are coloured by what the ingredient **is**, not by hashing its name. 番茄 is red, 小葱 is green, 胡萝卜 is orange, 豆腐 is that pale bean-green, 大米 and 盐 are neutral. Hashing produced 小葱 in pink and 豆腐 in purple — technically distinct, but it reads as "this app doesn't recognise the food".

  A keyword table maps ingredient names to eleven hue families (longest keyword wins, so 咸蛋黄 is orange rather than yellow), and each colour is generated as `hsl(h, s%, l%)` with **fixed lightness for background and text**. That means contrast is guaranteed by construction rather than hoped for, and the only thing that moves is the hue — which is what makes the palette look deliberate.

- Tags are now pills (`borderRadius: 999`) with more horizontal padding, so they read as chips and stop touching the surrounding characters.

**Rejected — asking the model for the colour.** Three reasons, in order of weight: (1) generated hex values are unstable, so redoing a dish would recolour it for no reason; (2) a model-chosen hex gives no guarantee that dark text on it is legible, and the current design deliberately renders dark text on a light background; (3) it costs output tokens and the model does not guarantee two ingredients get different colours either. A lookup table is deterministic and covers the overwhelming majority of what a Chinese home kitchen actually uses; anything unknown falls back to a golden-angle hue, which still spreads out and still never collides.

**Tests**: `npm run check:tags` asserts the semantic hues (番茄 0°, 小葱 120°, 胡萝卜 28°, 豆腐 85°, 大米 210°), that the longer keyword wins (咸蛋黄 → 28°, not 鸡蛋's 48°), that three green ingredients get three different hues, and that an ingredient missing from the table still returns a valid `hsl()` pair.

## 2026-11-01 — Ingredient tags are soft chips that never collide

**Changed**

- `TAG_COLORS` (8 saturated hex strings rendered as solid blocks behind white text) became `TAG_PALETTE`: 18 `{ bg, text }` pairs using light backgrounds with dark text, and the tag corners went from 6 to 10.

  Prep and cooking pages are paragraphs of prose. Solid saturated blocks pulled the eye off the instruction being read, and eight dark hues are hard to tell apart from each other at a glance — the whole point of colouring the ingredient is to find the same ingredient again in a later step.

- Colour assignment is now per menu instead of per name. `buildMenuIngredientColorMap` hashes each name to a starting slot and then **linear-probes to the next free one**, so two ingredients in the same menu can never share a colour.

  Pure hashing cannot do this: with 18 colours and 10 ingredients the probability of no collision is a few percent, so collisions were effectively guaranteed. The tradeoff is that the same ingredient may take a different colour in a different menu — it is stable within one screenful, which is where it matters.

**Tests**: `npm run check:tags` asserts that a 11-ingredient two-dish menu yields 11 distinct backgrounds, that duplicate names collapse to one colour, that an empty menu returns `{}`, and that `getTagColor` still works without a menu context.

## 2026-11-01 — Floating balls stop moving between pages; the assistant knows where things are

**Fixed**

- The two floating balls sat at one height on the recipe page and another on prep/cooking, and a dragged position was reset every time the user paged back to the recipe overview.

  Cause: the bottom offset was derived from `session.status` (`'prep'`/`'cooking'` reserved 76 px for the bottom bar, anything else 16 px), and swiping the pager dispatches `SET_CURRENT_STAGE`, which rewrites `status`. So merely changing pages changed the ball's bounds, and an effect keyed on that offset snapped the ball back to the default.

  The bottom bar exists on **every** page of that screen, so the offset is now a constant, and the reset-on-offset-change effect is gone. Dragging persists across pages; the only remaining reset is entering the screen fresh.

**Changed**

- The assistant's system prompt now carries a 【界面位置】 table — where to edit a gram value, delete a dish, add one, redo the method, open the shopping list, see nutrition, switch stages, finish cooking, and open settings. It is also told that prep and cooking are read-only execution views, so when a user asks to change a number while looking at prep steps, it sends them back to the recipe page instead of pretending it can help.

  This started as "the assistant has no permission to edit, so it should say where to go" — but "直接在菜谱页点编辑" was too vague to be useful when the edit affordance is a pencil icon inside a card.

## 2026-11-01 — The editor only adjusts numbers; anything else is a redo

**Removed**

- 加食材 / 删食材 in the dish editor, and the `add_ingredient` / `remove_ingredient` edit operations with them.

  An ingredient added there went into the ingredient list and the shopping list, but nothing wrote it into the prep or cooking steps — so the dish listed an ingredient it never told you to use. Removing one had the mirror problem: the tag disappeared from the step text but the step's method still assumed it. A recipe that contradicts itself is worse than one you cannot edit.

  The editor now changes only gram values, seasoning amounts, and the dish name. Adding or removing an ingredient means rewriting the dish, which is the 「让 AI 重做」 path — that one produces ingredients and steps together, so they cannot drift apart.

- The `inventoryNames` option on `applyEdits`; it only existed to compute `isInInventory` for added ingredients. `removeTagFromText` went with the removal path.

**Added**

- 「让 AI 重做这道菜」 inside the editor: describe the change ("改成先焯水再炒，少放油" / "加蘑菇"), and the dish is regenerated as a whole via `generateOneDishStream` and swapped in with a `replace_dish` edit. This is the answer to "how do I change the method, not just the numbers" — local edits can rewrite an existing number inside a step, but they cannot invent a new step. The UI states plainly that a redo replaces the dish and discards the numbers typed above.
- `useDishGeneration` shares the generation context between 加菜 and 重做菜 instead of each building it separately.

**Fixed**

- **Proportional scaling was one-directional**: editing an ingredient rescaled the seasonings, but editing a seasoning left every ingredient where it was. Both directions now work; a seasoning's ratio is derived from its gram amount, and `"适量"` / `"1汤匙"` cannot yield a ratio so nothing is rescaled (rather than guessing).
- The editor sheet's footer was pushed past the bottom of the screen once the content grew, letting the page behind show through underneath. The scroll area is now allowed to shrink (`flexShrink: 1`) so the buttons stay on screen.

- **The strip of page visible below the sheet was the Modal window itself, not the sheet's padding.** On Android a `transparent` Modal is inset by the system navigation bar unless it is told to draw behind it, so the sheet ended above the bar and the Activity content showed through in the gap — most visible on edge-to-edge / gesture-nav devices. Both bottom sheets (`DishSheets`, `CompletionSheet`) now pass `statusBarTranslucent` and `navigationBarTranslucent`, and the safe-area inset does its job again.
- Editor copy trimmed to state the consequence in one clause instead of explaining the reasoning: 「改用量会同步到步骤」, 「改一个，其余按同倍数跟着变」, 「写「10g」计入热量，「适量」不计」. The one explanation kept is 「整道菜替换，上面改的不生效」, because it prevents silently losing work.

**Tests**: `parseGramAmount` (`10g`, `约 15 克`, `20`, and the zeros for `适量` / `1汤匙`) added; the `add_ingredient` case removed.

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
