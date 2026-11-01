import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Switch,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { Button } from './Button';
import { useSettings } from '../contexts/SettingsContext';
import { useInventory } from '../contexts/InventoryContext';
import { useCooking } from '../contexts/CookingContext';
import { generateOneDishStream } from '../services/aiService';
import { dishLibraryService } from '../services/dishLibraryService';
import {
  computeCalories,
  parseGramAmount,
  scaleGramAmount,
  type MenuEdit,
} from '../services/menuEditService';
import type { DishPlan, SavedDish } from '../types';

// ---------------------------------------------------------------------------
// 共用外壳
// ---------------------------------------------------------------------------

export function SheetShell({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const { height: windowHeight } = useWindowDimensions();
  // 键盘弹起时：整个弹层往上让开（overlay 的 paddingBottom），
  // 同时用**像素**重算 maxHeight —— 百分比是相对父容器算的，一旦哪天
  // padding 没参与计算，88% 就会顶到屏幕外面去，弹层上半截被切掉
  const sheetMaxHeight = Math.min(
    windowHeight * 0.88,
    windowHeight - keyboardHeight - insets.top - SPACING.lg,
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // 不加这两个，Modal 的窗口会被系统状态栏/导航栏让开一条，
      // 底部就露出下面页面的文字（异形屏上尤其明显）。加了才真正铺满全屏，
      // 再由下面的 safe-area padding 把按钮托到手势条上方。
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[styles.overlay, { paddingBottom: keyboardHeight }]}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: sheetMaxHeight,
              // 键盘弹起时底部已经贴在键盘上，再按手势条留白就是多出来的一条空白
              paddingBottom: keyboardHeight > 0
                ? SPACING.md
                : Math.max(insets.bottom, SPACING.md) + SPACING.sm,
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderText}>
              <Text style={styles.sheetTitle}>{title}</Text>
              {subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
          {children}
          {footer}
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 生成一道菜（加菜 / 重做菜 共用）
// ---------------------------------------------------------------------------

/** 唯一需要 AI 的操作：造出一道菜。删和改都是本地确定性动作，不走模型。 */
function useDishGeneration() {
  const { state: settingsState } = useSettings();
  const inventoryState = useInventory().state;
  const { state: cookingState } = useCooking();

  const menu = cookingState.session?.stages.menu?.menuProposal;
  const requirement = cookingState.session?.stages.requirement;

  return useCallback(
    (instruction: string, mode: 'add' | 'replace') =>
      new Promise<DishPlan>((resolve, reject) => {
        if (!menu || !requirement) {
          reject(new Error('当前没有可用的菜谱'));
          return;
        }
        generateOneDishStream(
          instruction,
          mode,
          {
            dishNames: menu.dishes.map((d) => d.name),
            ingredients: inventoryState.ingredients.map((i) => ({
              name: i.name,
              weight: i.weight,
              createDate: i.createDate,
            })),
            seasonings: inventoryState.seasonings.map((s) => ({ name: s.name, status: s.status })),
            requirement,
            dietaryRestrictions: settingsState.preferences.dietaryRestrictions,
            tastePreferences: settingsState.preferences.tastePreferences,
            cookingSkill: settingsState.preferences.cookingSkill,
          },
          settingsState.preferences,
          { onDone: resolve, onError: reject },
        );
      }),
    [menu, requirement, inventoryState.ingredients, inventoryState.seasonings, settingsState.preferences],
  );
}

// ---------------------------------------------------------------------------
// 编辑一道菜
// ---------------------------------------------------------------------------

interface IngredientDraft {
  name: string;
  grams: string;
  /** 每 100 克大卡；带着它才能在编辑时就地把热量算出来 */
  kcalPer100g?: number;
}

interface SeasoningDraft {
  name: string;
  amount: string;
  kcalPer100g?: number;
}

/** 正在编辑的那一格。失焦时用它算倍数，避免边打字边缩放把数字带飞 */
type Anchor =
  | { kind: 'ingredient'; name: string; value: string }
  | { kind: 'seasoning'; name: string; value: string };

/** 一键把整道菜的用量按比例放大/缩小 */
const SCALE_STEPS: { label: string; factor: number }[] = [
  { label: '×½', factor: 0.5 },
  { label: '×1.5', factor: 1.5 },
  { label: '×2', factor: 2 },
];

/**
 * 编辑一道菜的抽屉。
 *
 * 能改的是「菜名 + 食材克数 + 调料用量 + 删食材」——刻意不做步骤文案的手工编辑：
 * 步骤里的 [食材(Ng)] 标签必须和克数一致，手工改文本必然改出不一致，
 * 而克数/调料改动由 applyEdits 自动同步到步骤文案里。
 *
 * 不提供「加食材」：加进去以后备菜和炒制步骤不会提到它，菜谱就自相矛盾了。
 * 要换配料或换做法，走下面的「让 AI 重做这道菜」。
 *
 * 「按比例」默认开着，而且**两个方向都管**：改食材带动调料，改调料也带动食材 ——
 * 只往一个方向生效会显得很怪。
 */
export function DishEditorSheet({
  visible,
  dish,
  onClose,
  onSave,
}: {
  visible: boolean;
  dish: DishPlan | null;
  onClose: () => void;
  onSave: (edits: MenuEdit[]) => void;
}) {
  const generateDish = useDishGeneration();

  const [name, setName] = useState('');
  const [rows, setRows] = useState<IngredientDraft[]>([]);
  const [seasonings, setSeasonings] = useState<SeasoningDraft[]>([]);
  const [proportional, setProportional] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** AI 重做这道菜 */
  const [redoPrompt, setRedoPrompt] = useState('');
  const [redoing, setRedoing] = useState(false);
  const [redoError, setRedoError] = useState<string | null>(null);

  const anchorRef = useRef<Anchor | null>(null);

  // 每次打开都用当前这道菜重置草稿，避免上一次编辑的残留
  useEffect(() => {
    if (!visible || !dish) return;
    setName(dish.name);
    setRows(
      dish.ingredients.map((i) => ({
        name: i.name,
        grams: String(i.estimatedWeight),
        kcalPer100g: i.kcalPer100g,
      })),
    );
    setSeasonings(
      dish.seasonings.map((s) => ({ name: s.name, amount: s.amount, kcalPer100g: s.kcalPer100g })),
    );
    setProportional(true);
    anchorRef.current = null;
    setError(null);
    setRedoPrompt('');
    setRedoError(null);
    setRedoing(false);
  }, [visible, dish]);

  /**
   * 按倍数缩放除锚点以外的一切。
   * 食材用数字比值，调料用能解析出的克数比值（"适量"算不出比值，就不缩放）。
   */
  const scaleOthers = useCallback(
    (anchor: Anchor) => {
      if (!proportional) return null;

      let factor = 0;
      if (anchor.kind === 'ingredient') {
        const row = rows.find((r) => r.name === anchor.name);
        if (!row) return null;
        const oldG = Number(anchor.value) || 0;
        const newG = Number(row.grams) || 0;
        if (oldG > 0 && newG > 0) factor = newG / oldG;
      } else {
        const s = seasonings.find((x) => x.name === anchor.name);
        if (!s) return null;
        const oldG = parseGramAmount(anchor.value);
        const newG = parseGramAmount(s.amount);
        if (oldG > 0 && newG > 0) factor = newG / oldG;
      }
      if (!factor || Math.abs(factor - 1) < 0.0001) return null;

      return {
        rows: rows.map((r) =>
          anchor.kind === 'ingredient' && r.name === anchor.name
            ? r
            : { ...r, grams: String(Math.max(1, Math.round((Number(r.grams) || 0) * factor))) },
        ),
        seasonings: seasonings.map((s) =>
          anchor.kind === 'seasoning' && s.name === anchor.name
            ? s
            : { ...s, amount: scaleGramAmount(s.amount, factor) },
        ),
      };
    },
    [proportional, rows, seasonings],
  );

  /**
   * 收尾（失焦或保存时）：算出缩放结果并清掉锚点。
   *
   * 点保存会先让输入框失焦，onBlur 里的 setState 不一定赶在 handleSave 读 state 之前生效，
   * 只靠 onBlur 会静默丢掉这次调整；所以保存时会再调一次同样的逻辑（锚点已被前一次清掉时
   * 它就是空操作，不会重复缩放）。
   */
  const settle = useCallback(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    return scaleOthers(anchor as Anchor) ?? { rows, seasonings };
  }, [scaleOthers, rows, seasonings]);

  const onGramsFocus = useCallback((name: string, grams: string) => {
    anchorRef.current = { kind: 'ingredient', name, value: grams };
  }, []);

  const onSeasoningFocus = useCallback((name: string, amount: string) => {
    anchorRef.current = { kind: 'seasoning', name, value: amount };
  }, []);

  /** 失焦才缩放：把 50 改成 500 的过程中会先经过 5，那一下会把整道菜缩成 1/10 */
  const onBlurSettle = useCallback(() => {
    const next = settle();
    setRows(next.rows);
    setSeasonings(next.seasonings);
  }, [settle]);

  /** 整道菜按倍数走：食材和调料一起，否则米饭的水、菜的油盐会留在原地 */
  const scaleAll = useCallback((factor: number) => {
    if (factor === 1) return;
    anchorRef.current = null;
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        grams: String(Math.max(1, Math.round((Number(r.grams) || 0) * factor))),
      })),
    );
    setSeasonings((prev) => prev.map((s) => ({ ...s, amount: scaleGramAmount(s.amount, factor) })));
  }, []);

  const setGrams = useCallback((name: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.name === name ? { ...r, grams: value } : r)));
    setError(null);
  }, []);

  const setSeasoningAmount = useCallback((name: string, amount: string) => {
    setSeasonings((prev) => prev.map((s) => (s.name === name ? { ...s, amount } : s)));
    setError(null);
  }, []);

  // 边改边算热量：改完立刻看得到，不用保存后才知道
  const liveCalories = useMemo(() => {
    if (!dish) return null;
    const draftDish: DishPlan = {
      ...dish,
      ingredients: rows.map((r) => ({
        name: r.name,
        estimatedWeight: Number(r.grams) || 0,
        isInInventory: false,
        kcalPer100g: r.kcalPer100g,
      })),
      seasonings: seasonings.map((s) => ({
        name: s.name,
        amount: s.amount,
        isInInventory: false,
        kcalPer100g: s.kcalPer100g,
      })),
    };
    const { kcal, covered } = computeCalories(draftDish);
    if (covered === 0) return null;
    return { kcal: Math.round(kcal), partial: covered < rows.length };
  }, [dish, rows, seasonings]);

  const handleSave = useCallback(() => {
    if (!dish) return;
    const finalName = name.trim();
    if (!finalName) {
      setError('菜名不能为空');
      return;
    }

    const settled = settle();
    const finalRows = settled.rows;
    const finalSeasonings = settled.seasonings;

    const badGrams = finalRows.find((r) => !/^\d+$/.test(r.grams.trim()) || Number(r.grams) <= 0);
    if (badGrams) {
      setError(`「${badGrams.name}」的克数要填一个大于 0 的整数`);
      return;
    }

    const edits: MenuEdit[] = [];

    // 先处理食材和调料，最后再改菜名：applyEdits 按顺序执行，改名之后旧名字就找不到了
    for (const original of dish.ingredients) {
      const row = finalRows.find((r) => r.name === original.name);
      if (!row) continue;
      const grams = Number(row.grams);
      if (grams !== original.estimatedWeight) {
        edits.push({ op: 'set_grams', dish: dish.name, ingredient: original.name, grams });
      }
    }

    for (const original of dish.seasonings) {
      const draft = finalSeasonings.find((s) => s.name === original.name);
      const next = draft?.amount.trim();
      if (!next || next === original.amount) continue;
      edits.push({
        op: 'set_seasoning_amount',
        dish: dish.name,
        seasoning: original.name,
        amount: next,
      });
    }

    if (finalName !== dish.name) {
      edits.push({ op: 'rename_dish', dish: dish.name, newName: finalName });
    }

    onSave(edits);
  }, [dish, name, settle, onSave]);

  const handleRedo = useCallback(async () => {
    if (!dish) return;
    const text = redoPrompt.trim();
    if (!text || redoing) return;
    setRedoing(true);
    setRedoError(null);
    try {
      const next = await generateDish(text, 'replace');
      anchorRef.current = null;
      onSave([{ op: 'replace_dish', dish: dish.name, generated: next }]);
    } catch (e: any) {
      setRedoError(e?.message || '重做失败，请重试');
      setRedoing(false);
    }
  }, [dish, redoPrompt, redoing, generateDish, onSave]);

  const dirty = useMemo(() => {
    if (!dish) return false;
    if (name.trim() !== dish.name) return true;
    if (
      rows.some((r) => {
        const original = dish.ingredients.find((i) => i.name === r.name);
        return !original || String(original.estimatedWeight) !== r.grams.trim();
      })
    ) {
      return true;
    }
    return seasonings.some((s) => {
      const original = dish.seasonings.find((x) => x.name === s.name);
      return !original || original.amount !== s.amount.trim();
    });
  }, [dish, name, rows, seasonings]);

  if (!dish) return null;

  return (
    <SheetShell
      visible={visible}
      title="编辑这道菜"
      subtitle="改用量会同步到步骤"
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Button title="取消" variant="ghost" onPress={onClose} style={styles.footerBtn} />
          <Button
            title={dirty ? '保存' : '没有改动'}
            variant="primary"
            onPress={handleSave}
            disabled={!dirty || redoing}
            style={styles.footerBtn}
          />
        </View>
      }
    >
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.fieldLabel}>菜名</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError(null);
          }}
          placeholder="这道菜叫什么"
          placeholderTextColor={COLORS.textTertiary}
        />

        <View style={styles.switchRow}>
          <View style={styles.switchLabelWrap}>
            <Text style={styles.switchLabel}>按比例</Text>
            <Text style={styles.switchHint}>
              {proportional ? '改一个，其余按同倍数跟着变' : '只改这一项'}
            </Text>
          </View>
          <Switch
            value={proportional}
            onValueChange={setProportional}
            trackColor={{ false: COLORS.border, true: COLORS.primary }}
            thumbColor={COLORS.textWhite}
          />
        </View>

        <View style={styles.labelRow}>
          <Text style={styles.fieldLabel}>食材</Text>
          {liveCalories ? (
            <Text style={styles.liveCalories}>
              约 {liveCalories.kcal} 大卡{liveCalories.partial ? '（部分食材缺热量密度）' : ''}
            </Text>
          ) : (
            <Text style={styles.liveCaloriesStale}>热量不会重算</Text>
          )}
        </View>

        {!liveCalories && (
          <Text style={styles.staleHint}>旧数据没有热量密度，用下面的「重做」可修复。</Text>
        )}

        <View style={styles.scaleRow}>
          <Text style={styles.scaleHint}>整道菜</Text>
          {SCALE_STEPS.map((s) => (
            <TouchableOpacity
              key={s.label}
              style={styles.scaleChip}
              onPress={() => scaleAll(s.factor)}
              activeOpacity={0.7}
            >
              <Text style={styles.scaleChipText}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {rows.length === 0 ? (
          <Text style={styles.emptyHint}>没有食材了，用下面的「重做」重新生成。</Text>
        ) : (
          rows.map((row) => (
            <View key={row.name} style={styles.ingredientRow}>
              <Text style={styles.ingredientName} numberOfLines={1}>
                {row.name}
              </Text>
              <TextInput
                style={styles.gramsInput}
                value={row.grams}
                onChangeText={(v) => setGrams(row.name, v.replace(/[^0-9]/g, ''))}
                onFocus={() => onGramsFocus(row.name, row.grams)}
                onBlur={onBlurSettle}
                keyboardType="number-pad"
                maxLength={5}
              />
              <Text style={styles.gramsUnit}>g</Text>
            </View>
          ))
        )}

        {seasonings.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>调料</Text>
            {seasonings.map((s) => (
              <View key={s.name} style={styles.ingredientRow}>
                <Text style={styles.ingredientName} numberOfLines={1}>
                  {s.name}
                </Text>
                <TextInput
                  style={styles.amountInput}
                  value={s.amount}
                  onChangeText={(v) => setSeasoningAmount(s.name, v)}
                  onFocus={() => onSeasoningFocus(s.name, s.amount)}
                  onBlur={onBlurSettle}
                  placeholder="用量"
                  placeholderTextColor={COLORS.textTertiary}
                  maxLength={12}
                />
              </View>
            ))}
            <Text style={styles.readonlyHint}>写「10g」计入热量，「适量」不计。</Text>
          </>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* 换配料、换做法走 AI —— 这是本地改不出来的那部分 */}
        <View style={styles.redoBox}>
          <Text style={styles.redoTitle}>换配料或做法？</Text>
          <Text style={styles.redoHint}>交给 AI 重写。整道菜替换，上面改的不生效。</Text>
          <TextInput
            style={[styles.input, styles.multiline, styles.redoInput]}
            value={redoPrompt}
            onChangeText={(v) => {
              setRedoPrompt(v);
              setRedoError(null);
            }}
            placeholder="例如：先焯水再炒，少放油"
            placeholderTextColor={COLORS.textTertiary}
            multiline
            editable={!redoing}
            maxLength={120}
          />
          <Button
            title="让 AI 重做"
            variant="secondary"
            onPress={handleRedo}
            loading={redoing}
            disabled={!redoPrompt.trim() || redoing}
          />
          {redoError ? <Text style={styles.errorText}>{redoError}</Text> : null}
        </View>
      </ScrollView>
    </SheetShell>
  );
}

// ---------------------------------------------------------------------------
// 加一道菜（这里才需要 AI）
// ---------------------------------------------------------------------------

/**
 * 加菜是全应用仅有的两处 AI 造内容之一（另一处是重做某道菜）。
 * 生成出来先给用户看一眼，确认后才进菜单。
 */
export function AddDishSheet({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (dish: DishPlan) => void;
}) {
  const generateDish = useDishGeneration();

  const [instruction, setInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<DishPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setInstruction('');
    setDraft(null);
    setError(null);
    setGenerating(false);
  }, [visible]);

  const generate = useCallback(() => {
    const text = instruction.trim();
    if (!text || generating) return;
    setGenerating(true);
    setDraft(null);
    setError(null);
    generateDish(text, 'add')
      .then((dish) => {
        setGenerating(false);
        setDraft(dish);
      })
      .catch((e: any) => {
        setGenerating(false);
        setError(e?.message || '生成失败，请重试');
      });
  }, [instruction, generating, generateDish]);

  return (
    <SheetShell
      visible={visible}
      title="加一道菜"
      subtitle="AI 结合库存和人数生成"
      onClose={onClose}
      footer={
        draft ? (
          <View style={styles.footer}>
            <Button title="换一道" variant="ghost" onPress={generate} style={styles.footerBtn} />
            <Button
              title="加入菜单"
              variant="primary"
              onPress={() => onAdd(draft)}
              style={styles.footerBtn}
            />
          </View>
        ) : (
          <View style={styles.footer}>
            <Button title="取消" variant="ghost" onPress={onClose} style={styles.footerBtn} />
            <Button
              title="让 AI 想一道"
              variant="primary"
              onPress={generate}
              loading={generating}
              disabled={!instruction.trim() || generating}
              style={styles.footerBtn}
            />
          </View>
        )
      }
    >
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {!draft && (
          <>
            <Text style={styles.fieldLabel}>想要什么菜</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={instruction}
              onChangeText={setInstruction}
              placeholder="例如：清淡的汤 / 想吃辣的"
              placeholderTextColor={COLORS.textTertiary}
              multiline
              editable={!generating}
              maxLength={120}
            />
          </>
        )}

        {generating && (
          <View style={styles.generatingBox}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.generatingText}>正在想这道菜…</Text>
          </View>
        )}

        {draft && (
          <View style={styles.preview}>
            <Text style={styles.previewName}>{draft.name}</Text>
            <Text style={styles.previewMeta}>
              {draft.estimatedNutrition.calories} 大卡 · 备菜 {draft.prepSteps.length} 步 · 炒制{' '}
              {draft.cookingSteps.length} 步
            </Text>
            <View style={styles.previewIngredients}>
              {draft.ingredients.map((i) => (
                <View key={i.name} style={styles.previewChip}>
                  <Text style={styles.previewChipText}>
                    {i.name} {i.estimatedWeight}g
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.overlay },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    // 内容再长也留出底部按钮的位置；配合 body 的 flexShrink，底部不会再被顶出屏幕
    maxHeight: '88%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sheetHeaderText: { flex: 1, marginRight: SPACING.md },
  sheetTitle: { fontSize: TYPOGRAPHY.h3, fontWeight: '700', color: COLORS.textPrimary },
  sheetSubtitle: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginTop: 2 },

  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { padding: SPACING.lg, paddingBottom: SPACING.md },

  // 挑菜列表：和 body 一样要 flexShrink，否则长列表把底部按钮顶出屏幕
  pickerScroll: { flexGrow: 0, flexShrink: 1 },
  pickerBody: { padding: SPACING.lg, gap: SPACING.sm },
  pickerEmpty: {
    fontSize: TYPOGRAPHY.bodySmall,
    color: COLORS.textTertiary,
    textAlign: 'center',
    paddingVertical: SPACING.xxl,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pickerRowOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryBg },
  pickerInfo: { flex: 1 },
  pickerName: { fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary },
  pickerMeta: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },

  fieldLabel: {
    fontSize: TYPOGRAPHY.bodySmall,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
    marginTop: SPACING.md,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.background,
    minHeight: 44,
  },
  multiline: { minHeight: 76, textAlignVertical: 'top' },

  liveCalories: { fontSize: TYPOGRAPHY.caption, color: COLORS.primary, fontWeight: '600' },
  liveCaloriesStale: { fontSize: TYPOGRAPHY.caption, color: COLORS.warningText },
  staleHint: {
    fontSize: TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
    lineHeight: 18,
    marginBottom: SPACING.sm,
  },

  scaleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  scaleHint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary },
  scaleChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryBg,
  },
  scaleChipText: { fontSize: TYPOGRAPHY.caption, color: COLORS.primary, fontWeight: '600' },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    marginTop: SPACING.sm,
  },
  switchLabelWrap: { flex: 1, marginRight: SPACING.md },
  switchLabel: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.textPrimary },
  switchHint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginTop: 2, lineHeight: 16 },

  ingredientRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs },
  ingredientName: { flex: 1, fontSize: TYPOGRAPHY.body, color: COLORS.textBody },
  gramsInput: {
    width: 62,
    textAlign: 'right',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.sm,
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.primary,
    fontWeight: '600',
    backgroundColor: COLORS.surface,
  },
  gramsUnit: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textTertiary, marginLeft: 4, width: 12 },
  amountInput: {
    width: 92,
    textAlign: 'right',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.sm,
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
    fontSize: TYPOGRAPHY.bodySmall,
    color: COLORS.primary,
    fontWeight: '600',
    backgroundColor: COLORS.surface,
  },

  readonlyHint: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, lineHeight: 20 },
  emptyHint: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textTertiary },
  errorText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.danger, marginTop: SPACING.md },

  redoBox: {
    marginTop: SPACING.xl,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  redoTitle: { fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary },
  redoHint: {
    fontSize: TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
    lineHeight: 18,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  redoInput: { marginBottom: SPACING.md },

  footer: {
    flexDirection: 'row',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  footerBtn: { flex: 1 },

  generatingBox: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.lg },
  generatingText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },

  preview: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginTop: SPACING.md,
  },
  previewName: { fontSize: TYPOGRAPHY.h3, fontWeight: '700', color: COLORS.textPrimary },
  previewMeta: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: SPACING.xs },
  previewIngredients: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.md },
  previewChip: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  previewChipText: { fontSize: TYPOGRAPHY.caption, color: COLORS.textBody },
});

// ---------------------------------------------------------------------------
// 挑做过的菜（生成菜单时复用）
// ---------------------------------------------------------------------------

/**
 * 勾旧菜。**不限条数** —— 勾满一桌就是"这次不想要新菜"，
 * 那是正常诉求，加个上限反而挡住它。
 */
export function DishPickerSheet({
  visible,
  selected,
  onClose,
  onChange,
}: {
  visible: boolean;
  selected: SavedDish[];
  onClose: () => void;
  onChange: (next: SavedDish[]) => void;
}) {
  const [all, setAll] = useState<SavedDish[]>([]);
  const [loading, setLoading] = useState(false);
  const selectedIds = useMemo(() => new Set(selected.map((d) => d.id)), [selected]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    dishLibraryService
      .list()
      .then((items) => {
        if (alive) setAll(items);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [visible]);

  const toggle = useCallback(
    (dish: SavedDish) => {
      onChange(
        selectedIds.has(dish.id)
          ? selected.filter((d) => d.id !== dish.id)
          : [...selected, dish],
      );
    },
    [onChange, selected, selectedIds],
  );

  return (
    <SheetShell
      visible={visible}
      title="挑做过的菜"
      subtitle="勾中的菜原样沿用，AI 只补差的那部分"
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Button
            title={selected.length > 0 ? `用这 ${selected.length} 道（${selected.reduce((n, d) => n + (d.estimatedNutrition?.calories ?? 0), 0)} 大卡）` : '一道都还没勾'}
            onPress={onClose}
            variant="primary"
            style={styles.footerBtn}
            disabled={selected.length === 0}
          />
        </View>
      }
    >
      <ScrollView style={styles.pickerScroll} contentContainerStyle={styles.pickerBody}>
        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.xl }} />
        ) : all.length === 0 ? (
          <Text style={styles.pickerEmpty}>还没有做过的菜，先做完一次饭吧</Text>
        ) : (
          all.map((dish) => {
            const on = selectedIds.has(dish.id);
            return (
              <TouchableOpacity
                key={dish.id}
                style={[styles.pickerRow, on && styles.pickerRowOn]}
                onPress={() => toggle(dish)}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Ionicons
                  name={on ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={on ? COLORS.primary : COLORS.textTertiary}
                />
                <View style={styles.pickerInfo}>
                  <Text style={styles.pickerName} numberOfLines={1}>{dish.name}</Text>
                  <Text style={styles.pickerMeta}>
                    {dish.estimatedNutrition?.calories ?? 0} 大卡 · 当初 {dish.basePersonCount} 人份 · 做过 {dish.timesCooked} 次
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SheetShell>
  );
}
