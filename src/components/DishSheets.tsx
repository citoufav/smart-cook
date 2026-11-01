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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { Button } from './Button';
import { useSettings } from '../contexts/SettingsContext';
import { useInventory } from '../contexts/InventoryContext';
import { useCooking } from '../contexts/CookingContext';
import { generateOneDishStream } from '../services/aiService';
import { computeCalories, scaleGramAmount, type MenuEdit } from '../services/menuEditService';
import type { DishPlan } from '../types';

// ---------------------------------------------------------------------------
// 共用外壳
// ---------------------------------------------------------------------------

function SheetShell({
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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + SPACING.sm }]}>
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

/** 一键把整道菜的用量按比例放大/缩小 */
const SCALE_STEPS: { label: string; factor: number }[] = [
  { label: '×½', factor: 0.5 },
  { label: '×1.5', factor: 1.5 },
  { label: '×2', factor: 2 },
];

/**
 * 编辑一道菜的抽屉。
 *
 * 能改的是「菜名 + 食材克数 + 调料用量 + 增删食材」——刻意不做步骤文案的手工编辑：
 * 步骤里的 [食材(Ng)] 标签必须和克数一致，手工改文本必然改出不一致，
 * 而克数/调料用量改动由 applyEdits 自动同步到步骤文案里。
 *
 * 「按比例」默认开着：米饭的米和水、菜的料和调料本来就是锁比例的，
 * 改一个别的没跟上是明显的错。想单独调某一样就把它关掉。
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
  const [name, setName] = useState('');
  const [rows, setRows] = useState<IngredientDraft[]>([]);
  const [seasonings, setSeasonings] = useState<SeasoningDraft[]>([]);
  const [proportional, setProportional] = useState(true);
  const [newName, setNewName] = useState('');
  const [newGrams, setNewGrams] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** 聚焦时那一刻的克数。失焦时用它算倍数，避免边打字边缩放把数字带飞 */
  const focusAnchorRef = useRef<{ name: string; grams: string } | null>(null);

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
    focusAnchorRef.current = null;
    setNewName('');
    setNewGrams('');
    setError(null);
  }, [visible, dish]);

  /** 整道菜按倍数走：食材和调料一起，否则米饭的水、菜的油盐会留在原地 */
  const applyFactor = useCallback((factor: number, skipIngredient?: string) => {
    if (factor === 1) return;
    setRows((prev) =>
      prev.map((r) =>
        r.name === skipIngredient
          ? r
          : { ...r, grams: String(Math.max(1, Math.round((Number(r.grams) || 0) * factor))) },
      ),
    );
    setSeasonings((prev) =>
      prev.map((s) => ({ ...s, amount: scaleGramAmount(s.amount, factor) })),
    );
  }, []);

  const setGrams = useCallback((name: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.name === name ? { ...r, grams: value } : r)));
    setError(null);
  }, []);

  const onGramsFocus = useCallback((name: string, grams: string) => {
    focusAnchorRef.current = { name, grams };
  }, []);

  /**
   * 失焦时才按比例调整其余项。
   * 不能边打字边调：把 50 改成 500 的过程中会先经过 5，那一下会把整道菜缩成 1/10。
   */
  const onGramsBlur = useCallback(
    (name: string) => {
      const anchor = focusAnchorRef.current;
      focusAnchorRef.current = null;
      if (!proportional || !anchor || anchor.name !== name) return;
      const row = rows.find((r) => r.name === name);
      if (!row) return;
      const oldG = Number(anchor.grams) || 0;
      const newG = Number(row.grams) || 0;
      if (oldG <= 0 || newG <= 0 || oldG === newG) return;
      applyFactor(newG / oldG, name);
    },
    [proportional, rows, applyFactor],
  );

  const removeRow = useCallback((name: string) => {
    setRows((prev) => prev.filter((r) => r.name !== name));
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

  const addRow = useCallback(() => {
    const n = newName.trim();
    const g = newGrams.trim();
    if (!n) {
      setError('食材名不能为空');
      return;
    }
    if (rows.some((r) => r.name === n)) {
      setError(`「${n}」已经在食材列表里了`);
      return;
    }
    if (!/^\d+$/.test(g) || Number(g) <= 0) {
      setError('克数要填一个大于 0 的整数');
      return;
    }
    // 新加的食材没有密度，热量会按"部分缺密度"标出来，不会假装精确
    setRows((prev) => [...prev, { name: n, grams: g }]);
    setNewName('');
    setNewGrams('');
    setError(null);
  }, [newName, newGrams, rows]);

  /**
   * 把"正在编辑、还没来得及失焦"的那一项的倍数补算进来。
   *
   * 点保存会先让输入框失焦，`onGramsBlur` 里的 setState 不一定赶在 handleSave 读 state 之前生效，
   * 只靠 blur 会静默丢掉这次按比例调整。这里按同样的规则再算一遍，blur 先跑过就自然跳过
   * （它会把 anchor 清掉）。
   */
  const reconcilePendingScale = useCallback(() => {
    const anchor = focusAnchorRef.current;
    focusAnchorRef.current = null;
    if (!proportional || !anchor) return { finalRows: rows, finalSeasonings: seasonings };
    const row = rows.find((r) => r.name === anchor.name);
    if (!row) return { finalRows: rows, finalSeasonings: seasonings };
    const oldG = Number(anchor.grams) || 0;
    const newG = Number(row.grams) || 0;
    if (oldG <= 0 || newG <= 0 || oldG === newG) return { finalRows: rows, finalSeasonings: seasonings };
    const f = newG / oldG;
    return {
      finalRows: rows.map((r) =>
        r.name === row.name
          ? r
          : { ...r, grams: String(Math.max(1, Math.round((Number(r.grams) || 0) * f))) },
      ),
      finalSeasonings: seasonings.map((s) => ({ ...s, amount: scaleGramAmount(s.amount, f) })),
    };
  }, [proportional, rows, seasonings]);

  const handleSave = useCallback(() => {
    if (!dish) return;
    const finalName = name.trim();
    if (!finalName) {
      setError('菜名不能为空');
      return;
    }

    const { finalRows, finalSeasonings } = reconcilePendingScale();

    const badGrams = finalRows.find((r) => !/^\d+$/.test(r.grams.trim()) || Number(r.grams) <= 0);
    if (badGrams) {
      setError(`「${badGrams.name}」的克数要填一个大于 0 的整数`);
      return;
    }

    const edits: MenuEdit[] = [];

    // 先处理食材，最后再改菜名：applyEdits 按顺序执行，改名之后旧名字就找不到了
    for (const original of dish.ingredients) {
      const row = finalRows.find((r) => r.name === original.name);
      if (!row) {
        edits.push({ op: 'remove_ingredient', dish: dish.name, ingredient: original.name });
        continue;
      }
      const grams = Number(row.grams);
      if (grams !== original.estimatedWeight) {
        edits.push({ op: 'set_grams', dish: dish.name, ingredient: original.name, grams });
      }
    }
    for (const row of finalRows) {
      if (dish.ingredients.some((i) => i.name === row.name)) continue;
      edits.push({
        op: 'add_ingredient',
        dish: dish.name,
        ingredient: row.name,
        grams: Number(row.grams),
      });
    }

    // 调料用量：编辑器里不增删调料，只改用量
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
  }, [dish, name, reconcilePendingScale, onSave]);

  const dirty = useMemo(() => {
    if (!dish) return false;
    if (name.trim() !== dish.name) return true;
    if (rows.length !== dish.ingredients.length) return true;
    if (rows.some((r) => {
      const original = dish.ingredients.find((i) => i.name === r.name);
      return !original || String(original.estimatedWeight) !== r.grams.trim();
    })) {
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
      subtitle="改克数会同步更新备菜和炒制步骤里的数字"
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Button title="取消" variant="ghost" onPress={onClose} style={styles.footerBtn} />
          <Button
            title={dirty ? '保存' : '没有改动'}
            variant="primary"
            onPress={handleSave}
            disabled={!dirty}
            style={styles.footerBtn}
          />
        </View>
      }
    >
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
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
            <Text style={styles.switchLabel}>按比例跟着变</Text>
            <Text style={styles.switchHint}>
              {proportional
                ? '改一个克数，其余食材和调料按同样倍数走（米饭的水、菜的油盐不会脱节）'
                : '只改你动的这一项，其余不动'}
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
            <Text style={styles.liveCaloriesStale}>改克数不会重算热量</Text>
          )}
        </View>

        {!liveCalories && (
          <Text style={styles.staleHint}>
            这道菜是旧版本存的，AI 没给每种食材的热量密度，所以热量没法按克数算。重新生成一份菜单就可以。
          </Text>
        )}

        <View style={styles.scaleRow}>
          <Text style={styles.scaleHint}>整道菜按比例：</Text>
          {SCALE_STEPS.map((s) => (
            <TouchableOpacity key={s.label} style={styles.scaleChip} onPress={() => applyFactor(s.factor)} activeOpacity={0.7}>
              <Text style={styles.scaleChipText}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {rows.length === 0 ? (
          <Text style={styles.emptyHint}>还没有食材，加一个吧</Text>
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
                onBlur={() => onGramsBlur(row.name)}
                keyboardType="number-pad"
                maxLength={5}
              />
              <Text style={styles.gramsUnit}>g</Text>
              <TouchableOpacity onPress={() => removeRow(row.name)} hitSlop={10} style={styles.removeBtn}>
                <Ionicons name="close-circle" size={20} color={COLORS.textTertiary} />
              </TouchableOpacity>
            </View>
          ))
        )}

        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, styles.addNameInput]}
            value={newName}
            onChangeText={(v) => {
              setNewName(v);
              setError(null);
            }}
            placeholder="加一个食材"
            placeholderTextColor={COLORS.textTertiary}
          />
          <TextInput
            style={[styles.input, styles.addGramsInput]}
            value={newGrams}
            onChangeText={(v) => {
              setNewGrams(v.replace(/[^0-9]/g, ''));
              setError(null);
            }}
            placeholder="克"
            placeholderTextColor={COLORS.textTertiary}
            keyboardType="number-pad"
            maxLength={5}
          />
          <TouchableOpacity style={styles.addBtn} onPress={addRow} activeOpacity={0.7}>
            <Ionicons name="add" size={20} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

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
                  placeholder="用量"
                  placeholderTextColor={COLORS.textTertiary}
                  maxLength={12}
                />
              </View>
            ))}
            <Text style={styles.readonlyHint}>调料用量写「10g」这类能算热量的写法，就会一起计入热量；「适量」只做显示。</Text>
          </>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
    </SheetShell>
  );
}

// ---------------------------------------------------------------------------
// 加一道菜（这里才需要 AI）
// ---------------------------------------------------------------------------

/**
 * 加菜是全应用唯一需要 AI 造内容的地方：删和改都是确定性操作，按钮直接做。
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
  const { state: settingsState } = useSettings();
  const inventoryState = useInventory().state;
  const { state: cookingState } = useCooking();

  const [instruction, setInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<DishPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const menu = cookingState.session?.stages.menu?.menuProposal;
  const requirement = cookingState.session?.stages.requirement;

  useEffect(() => {
    if (!visible) return;
    setInstruction('');
    setDraft(null);
    setError(null);
    setGenerating(false);
  }, [visible]);

  const generate = useCallback(() => {
    const text = instruction.trim();
    if (!text || generating || !menu || !requirement) return;
    setGenerating(true);
    setDraft(null);
    setError(null);

    generateOneDishStream(
      text,
      'add',
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
      {
        onDone: (dish) => {
          setGenerating(false);
          setDraft(dish);
        },
        onError: (e) => {
          setGenerating(false);
          setError(e.message || '生成失败，请重试');
        },
      },
    );
  }, [
    instruction,
    generating,
    menu,
    requirement,
    inventoryState.ingredients,
    inventoryState.seasonings,
    settingsState.preferences,
  ]);

  return (
    <SheetShell
      visible={visible}
      title="加一道菜"
      subtitle="描述你想要什么，AI 会结合库存和人数生成"
      onClose={onClose}
      footer={
        draft ? (
          <View style={styles.footer}>
            <Button title="换一道" variant="ghost" onPress={generate} style={styles.footerBtn} />
            <Button title="加入菜单" variant="primary" onPress={() => onAdd(draft)} style={styles.footerBtn} />
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
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        {!draft && (
          <>
            <Text style={styles.fieldLabel}>想要什么菜</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={instruction}
              onChangeText={setInstruction}
              placeholder="例如：来个清淡的汤、想吃点辣的、用掉冰箱的鸡胸肉"
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

  body: { flexGrow: 0 },
  bodyContent: { padding: SPACING.lg, paddingBottom: SPACING.md },

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
  liveCalories: { fontSize: TYPOGRAPHY.caption, color: COLORS.primary, fontWeight: '600' },
  liveCaloriesStale: { fontSize: TYPOGRAPHY.caption, color: COLORS.warningText },
  staleHint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, lineHeight: 18, marginBottom: SPACING.sm },
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
  multiline: { minHeight: 88, textAlignVertical: 'top' },

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
  removeBtn: { marginLeft: SPACING.sm },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md },
  addNameInput: { flex: 1 },
  addGramsInput: { width: 64, textAlign: 'center' },
  addBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryBg,
  },

  readonlyHint: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, lineHeight: 20 },
  emptyHint: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textTertiary },
  errorText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.danger, marginTop: SPACING.md },

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
