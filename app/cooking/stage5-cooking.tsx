import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useCooking } from '../../src/contexts/CookingContext';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import { CookingStep } from '../../src/types';
import { IngredientTagText } from '../../src/components/IngredientTagText';

export function Stage5CookingContent() {
  const { state } = useCooking();
  const menuProposal = state.session?.stages.menu?.menuProposal;
  const [expandedDishIndex, setExpandedDishIndex] = useState(0);

  const cookingSteps = menuProposal?.cookingSteps;

  // Rules of Hooks: useMemo 必须无条件执行，放在 early return 之前，
  // 避免"无数据→有数据"的渲染序列导致 hook 数量变化 → 崩溃
  const groupedDishes = useMemo(() => {
    if (!cookingSteps) return [] as [string, CookingStep[]][];
    const map = new Map<string, CookingStep[]>();
    for (const step of cookingSteps) {
      const list = map.get(step.dishName) || [];
      list.push(step);
      map.set(step.dishName, list);
    }
    return [...map.entries()];
  }, [cookingSteps]);

  if (!menuProposal || !cookingSteps || cookingSteps.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>暂无炒制数据</Text>
          {menuProposal && !cookingSteps && (
            <Text style={styles.emptyHint}>AI 返回的生成方案中缺少炒制步骤，请返回重新生成</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>炒制</Text>

        {groupedDishes.map(([dishName, steps], dishIndex) => {
          const isExpanded = expandedDishIndex === dishIndex;

          return (
            <View key={dishName} style={styles.dishCard}>
              <TouchableOpacity
                style={styles.dishHeader}
                onPress={() => setExpandedDishIndex(isExpanded ? -1 : dishIndex)}
                activeOpacity={0.7}
              >
                <Text style={styles.dishName}>{dishName}</Text>
                <View style={styles.dishHeaderRight}>
                  <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
                </View>
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.stepList}>
                  {steps.map((step) => (
                    <View key={step.stepNumber} style={styles.stepRow}>
                      <IngredientTagText text={step.instruction} />
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: TYPOGRAPHY.body, color: COLORS.textSecondary },
  emptyHint: { fontSize: TYPOGRAPHY.caption, color: COLORS.danger, marginTop: SPACING.sm, textAlign: 'center', paddingHorizontal: SPACING.lg },
  title: { fontSize: TYPOGRAPHY.h2, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  progress: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, marginBottom: SPACING.lg },
  dishCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, marginBottom: SPACING.md, ...SHADOWS.sm, overflow: 'hidden' },
  dishHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.lg },
  dishHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  dishName: { fontSize: TYPOGRAPHY.h4, fontWeight: '700', color: COLORS.textPrimary },
  dishProgress: { fontSize: TYPOGRAPHY.caption, color: COLORS.primary },
  expandIcon: { fontSize: 12, color: COLORS.textSecondary },
  stepList: { padding: SPACING.lg, paddingTop: 0 },
  stepRow: { paddingVertical: SPACING.sm },
  stepRowDone: { opacity: 0.6 },
  bottomBar: { padding: SPACING.md, paddingBottom: SPACING.sm, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  doneButton: { backgroundColor: '#2D9F4E' },
});

export default Stage5CookingContent;
