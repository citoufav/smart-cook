import React, { useCallback, useEffect, useState } from 'react';
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
import { useCustomAlert } from '../../src/components/CustomAlert';
import { IngredientTagText } from '../../src/components/IngredientTagText';
import { COLORS, buildMenuIngredientColorMap } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import type { SavedDish } from '../../src/types';

export default function DishDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { showAlert } = useCustomAlert();

  const [dish, setDish] = useState<SavedDish | null>(null);
  const [loading, setLoading] = useState(true);

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
      ) : !dish ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>这道菜已经不在了</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xl }]}>
          <View style={styles.metaCard}>
            <Text style={styles.metaCalories}>{dish.estimatedNutrition.calories} 大卡</Text>
            <Text style={styles.metaLine}>
              {dish.basePersonCount} 人份 · 做过 {dish.timesCooked} 次
            </Text>
          </View>

          <Text style={styles.sectionTitle}>食材</Text>
          <View style={styles.panel}>
            {dish.ingredients.map((ing) => (
              <View key={ing.name} style={styles.row}>
                <Text style={styles.rowName}>{ing.name}</Text>
                <Text style={styles.rowValue}>{ing.estimatedWeight}g</Text>
              </View>
            ))}
            {dish.seasonings.length > 0 && (
              <>
                <View style={styles.divider} />
                {dish.seasonings.map((s) => (
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
            {dish.prepSteps.length === 0 ? (
              <Text style={styles.rowMuted}>这道菜没有单独的备菜步骤</Text>
            ) : (
              dish.prepSteps.map((step) => (
                <View key={step.id} style={styles.stepRow}>
                  <IngredientTagText text={step.description} colorMap={colorMap} />
                </View>
              ))
            )}
          </View>

          <Text style={styles.sectionTitle}>炒制</Text>
          <View style={styles.panel}>
            {dish.cookingSteps.length === 0 ? (
              <Text style={styles.rowMuted}>这道菜没有单独的炒制步骤</Text>
            ) : (
              dish.cookingSteps.map((step, i) => (
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
