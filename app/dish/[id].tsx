import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dishLibraryService } from '../../src/services/dishLibraryService';
import { scaleDish } from '../../src/services/menuEditService';
import { useCustomAlert } from '../../src/components/CustomAlert';
import { SelectableChip } from '../../src/components/SelectableChip';
import { IngredientTagText } from '../../src/components/IngredientTagText';
import { COLORS, buildMenuIngredientColorMap } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import type { SavedDish } from '../../src/types';

/**
 * 份量倍数。
 *
 * 只做「这次做多少」，**不写回菜品库** —— 想按 1.5 倍做一顿，不代表你的配方变成了 1.5 倍。
 * 纯本地缩放：食材克数、调料用量、步骤文案里的克重、热量一起动。
 */
const SCALE_OPTIONS = [0.5, 1, 1.5, 2, 3];

export default function DishDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { showAlert } = useCustomAlert();

  const [dish, setDish] = useState<SavedDish | null>(null);
  const [loading, setLoading] = useState(true);
  const [factor, setFactor] = useState(1);

  useEffect(() => {
    let alive = true;
    dishLibraryService
      .get(id)
      .then((d) => {
        if (alive) setDish(d ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const handleDelete = useCallback(() => {
    if (!dish) return;
    showAlert({
      title: `删除「${dish.name}」？`,
      message: '只是从菜品库里删掉，不会影响做菜记录。',
      buttons: [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            await dishLibraryService.remove(dish.id);
            router.back();
          },
        },
      ],
    });
  }, [dish, showAlert]);

  const colorMap = dish
    ? buildMenuIngredientColorMap([dish])
    : {};

  // 永远从原配方缩放，不在缩放结果上再缩放（否则每点一次都乘一遍）
  const shown = useMemo(() => (dish ? scaleDish(dish, factor) : null), [dish, factor]);
  const totalGrams = useMemo(
    () => (shown ? shown.ingredients.reduce((n, i) => n + i.estimatedWeight, 0) : 0),
    [shown],
  );
  // 倍数换算成人数只是个说明，允许它不整除（2 人份 ×1.5 = 3 人份）
  const scaledPeople = dish ? Math.max(1, Math.round(dish.basePersonCount * factor)) : 1;

  const handleSaveScaled = useCallback(() => {
    if (!dish || !shown || factor === 1) return;
    showAlert({
      title: '保存这份用量？',
      message: `会用 ${scaledPeople} 人份的用量覆盖「${dish.name}」原来的配方，旧用量不保留。`,
      buttons: [
        { text: '取消', style: 'cancel' },
        {
          text: '保存',
          onPress: async () => {
            const next: SavedDish = {
              ...dish,
              name: shown.name,
              ingredients: shown.ingredients.map((i) => ({ ...i })),
              seasonings: shown.seasonings.map((s) => ({ ...s })),
              estimatedNutrition: { ...shown.estimatedNutrition },
              prepSteps: shown.prepSteps.map((s) => ({ ...s, isCompleted: false })),
              cookingSteps: shown.cookingSteps.map((s) => ({ ...s, isCompleted: false })),
              basePersonCount: scaledPeople,
            };
            const ok = await dishLibraryService.replace(next);
            if (!ok) {
              showAlert({
                title: '没保存成功',
                message: '写本地存储失败（可能是空间不足）。配方没变，可以再试一次。',
                buttons: [{ text: '知道了' }],
              });
              return;
            }
            setDish(next);
            setFactor(1);
          },
        },
      ],
    });
  }, [dish, shown, factor, scaledPeople, showAlert]);

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + SPACING.sm }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>
          {dish?.name ?? '菜品'}
        </Text>
        <TouchableOpacity onPress={handleDelete} hitSlop={12} disabled={!dish}>
          <Ionicons name="trash-outline" size={21} color={dish ? COLORS.danger : COLORS.textTertiary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : !dish || !shown ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>这道菜已经不在了</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xl }]}>
          <View style={styles.metaCard}>
            <Text style={styles.metaCalories}>{shown.estimatedNutrition.calories} 大卡</Text>
            <Text style={styles.metaLine}>
              {dish.basePersonCount} 人份 · 食材共 {totalGrams}g · 做过 {dish.timesCooked} 次
            </Text>
          </View>

          <Text style={styles.sectionTitle}>这次做多少</Text>
          <View style={styles.panel}>
            <View style={styles.scaleRow}>
              {SCALE_OPTIONS.map((opt) => (
                <SelectableChip
                  key={opt}
                  label={opt === 1 ? '原份量' : `×${opt}`}
                  selected={factor === opt}
                  onPress={() => setFactor(opt)}
                />
              ))}
            </View>
            <Text style={styles.scaleHint}>
              {factor === 1
                ? '想多做或少做就选倍数，下面的克数和步骤会一起变'
                : `按 ≈${scaledPeople} 人份换算，下面的克数和步骤已跟着变。不保存的话，退出就恢复原配方`}
            </Text>
            {factor !== 1 && (
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveScaled} activeOpacity={0.75}>
                <Ionicons name="bookmark-outline" size={16} color={COLORS.primary} />
                <Text style={styles.saveBtnText}>保存这份用量</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.sectionTitle}>食材</Text>
          <View style={styles.panel}>
            {shown.ingredients.map((ing) => (
              <View key={ing.name} style={styles.row}>
                <Text style={styles.rowName}>{ing.name}</Text>
                <Text style={styles.rowValue}>{ing.estimatedWeight}g</Text>
              </View>
            ))}
            {shown.seasonings.length > 0 && (
              <>
                <View style={styles.divider} />
                {shown.seasonings.map((s) => (
                  <View key={s.name} style={styles.row}>
                    <Text style={styles.rowMuted}>{s.name}</Text>
                    <Text style={styles.rowMuted}>{s.amount}</Text>
                  </View>
                ))}
              </>
            )}
          </View>

          <Text style={styles.sectionTitle}>备菜</Text>
          <View style={styles.panel}>
            {shown.prepSteps.length === 0 ? (
              <Text style={styles.rowMuted}>这道菜没有单独的备菜步骤</Text>
            ) : (
              shown.prepSteps.map((step) => (
                <View key={step.id} style={styles.stepRow}>
                  <IngredientTagText text={step.description} colorMap={colorMap} />
                </View>
              ))
            )}
          </View>

          <Text style={styles.sectionTitle}>炒制</Text>
          <View style={styles.panel}>
            {shown.cookingSteps.length === 0 ? (
              <Text style={styles.rowMuted}>这道菜没有单独的炒制步骤</Text>
            ) : (
              shown.cookingSteps.map((step, i) => (
                <View key={step.stepNumber} style={styles.stepRow}>
                  <Text style={styles.stepIndex}>{i + 1}</Text>
                  <View style={styles.stepBody}>
                    <IngredientTagText text={step.instruction} colorMap={colorMap} />
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: TYPOGRAPHY.body, color: COLORS.textSecondary },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  topTitle: { flex: 1, fontSize: TYPOGRAPHY.h4, fontWeight: '700', color: COLORS.textPrimary },

  content: { padding: SPACING.lg },
  metaCard: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  metaCalories: { fontSize: TYPOGRAPHY.h2, fontWeight: '800', color: COLORS.primary },
  metaLine: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, marginTop: SPACING.xs },

  scaleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  scaleHint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, lineHeight: 17, marginTop: SPACING.sm },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryBg,
  },
  saveBtnText: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '700', color: COLORS.primary },

  sectionTitle: {
    fontSize: TYPOGRAPHY.body,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  panel: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowName: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textBody, flex: 1 },
  rowValue: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.primary },
  rowMuted: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  divider: { height: 1, backgroundColor: COLORS.borderLight, marginVertical: SPACING.sm },
  stepRow: { flexDirection: 'row', paddingVertical: SPACING.xs, gap: SPACING.sm },
  stepIndex: {
    width: 20,
    fontSize: TYPOGRAPHY.caption,
    fontWeight: '700',
    color: COLORS.primary,
    paddingTop: 3,
  },
  stepBody: { flex: 1 },
});
