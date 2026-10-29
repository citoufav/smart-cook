import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../src/contexts/SettingsContext';
import { useInventory } from '../src/contexts/InventoryContext';
import { SelectableChip } from '../src/components/SelectableChip';
import { Button } from '../src/components/Button';
import { COLORS } from '../src/constants/colors';
import { TYPOGRAPHY } from '../src/constants/typography';
import { SPACING, BORDER_RADIUS } from '../src/constants/spacing';

// Presets shown on first launch. Tapping a chip writes it into the same fields
// the AI prompt already reads, so no extra merge/sync logic is needed.
const CUISINES = ['家常菜', '川菜', '粤菜', '日式', '韩式', '意式', '东南亚', '美式'];
const FLAVORS = ['清淡', '重口', '微辣', '酸辣', '鲜香', '甜口'];
const ALLERGENS = ['花生', '坚果', '海鲜', '虾蟹', '乳制品', '鸡蛋', '麸质', '大豆'];
const AVOIDANCES = ['不吃辣', '不吃猪肉', '不吃牛肉', '不吃羊肉', '不吃内脏', '不吃香菜', '不吃葱蒜'];
const PANTRY_STAPLES = [
  '鸡蛋', '番茄', '土豆', '洋葱', '青椒', '胡萝卜', '白菜', '西兰花',
  '豆腐', '猪肉', '鸡胸肉', '牛肉', '大米', '面条', '小葱', '大蒜',
];

const TITLES = ['你爱吃什么？', '你不能吃什么？', '家里现在有什么？'];
const SUBTITLES = [
  '选几样，AI 推荐菜单时会优先照顾',
  '过敏和忌口会写进每次菜单生成，避免踩雷',
  '点选常备食材直接加入库存，重量以后随时能改',
];

function toggleIn(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function ChipGroup({
  title,
  items,
  selected,
  onChange,
}: {
  title: string;
  items: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.chipWrap}>
        {items.map((item) => (
          <SelectableChip
            key={item}
            label={item}
            selected={selected.includes(item)}
            role="checkbox"
            onPress={() => onChange(toggleIn(selected, item))}
          />
        ))}
      </View>
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { updatePreferences } = useSettings();
  const { state: invState, addIngredient } = useInventory();

  const [step, setStep] = useState(0);
  const [taste, setTaste] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [pantry, setPantry] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Skipping still keeps whatever was already picked on earlier steps.
  const finish = useCallback(async () => {
    setSaving(true);
    await updatePreferences({
      tastePreferences: taste,
      dietaryRestrictions: avoid,
      onboardingDone: true,
    });
    const existing = new Set(invState.ingredients.map((i) => i.name));
    for (const name of pantry) {
      if (existing.has(name)) continue;
      try {
        await addIngredient(name, null);
      } catch {
        // One failed write must not trap the user on the onboarding screen.
      }
    }
    router.replace('/(tabs)');
  }, [taste, avoid, pantry, invState.ingredients, updatePreferences, addIngredient]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>
        {step < 2 && (
          <TouchableOpacity onPress={finish} hitSlop={12}>
            <Text style={styles.skip}>跳过</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{TITLES[step]}</Text>
        <Text style={styles.subtitle}>{SUBTITLES[step]}</Text>

        {step === 0 && (
          <>
            <ChipGroup title="偏爱菜系" items={CUISINES} selected={taste} onChange={setTaste} />
            <ChipGroup title="口味倾向" items={FLAVORS} selected={taste} onChange={setTaste} />
          </>
        )}
        {step === 1 && (
          <>
            <ChipGroup title="过敏（务必勾选）" items={ALLERGENS} selected={avoid} onChange={setAvoid} />
            <ChipGroup title="忌口" items={AVOIDANCES} selected={avoid} onChange={setAvoid} />
          </>
        )}
        {step === 2 && (
          <ChipGroup title="常备食材" items={PANTRY_STAPLES} selected={pantry} onChange={setPantry} />
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.lg }]}>
        {step > 0 && (
          <Button title="上一步" variant="ghost" onPress={() => setStep(step - 1)} />
        )}
        <Button
          title={step === 2 ? `完成${pantry.length > 0 ? `（加入 ${pantry.length} 项）` : ''}` : '下一步'}
          variant="primary"
          loading={saving}
          style={styles.grow}
          onPress={step === 2 ? finish : () => setStep(step + 1)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  dots: { flexDirection: 'row', gap: SPACING.xs },
  dot: { width: 22, height: 4, borderRadius: BORDER_RADIUS.full, backgroundColor: COLORS.border },
  dotActive: { backgroundColor: COLORS.primary },
  skip: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textTertiary },
  content: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  title: { fontSize: TYPOGRAPHY.h2, fontWeight: '700', color: COLORS.textPrimary },
  subtitle: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, marginTop: SPACING.sm },
  group: { marginTop: SPACING.xxl },
  groupTitle: {
    fontSize: TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  grow: { flex: 1 },
});
