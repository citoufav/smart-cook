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
import { CookingStep, IngredientTag } from '../../src/types';

/** Parse [ingredient(grams)] and [ingredient(non-gram)] tags in the instruction and render them as unified tags */
function InstructionText({
  text,
  ingredientTags,
}: {
  text: string;
  ingredientTags?: IngredientTag[];
}) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  // Two branches: ingredient(grams) | ingredient(non-gram description)
  const regex = /\[(.+?)\((\d+)g\)\]|\[(.+?)\((\S+?)\)\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`t${lastIndex}`} style={tagStyles.plainText}>{text.slice(lastIndex, match.index)}</Text>,
      );
    }
    if (match[3]) {
      // [ingredient(non-gram)] — a pinch, to taste, X spoonfuls, etc.
      const tagName = match[3];
      const tagDesc = match[4];
      const tagColor = ingredientTags?.find((t) => t.name === tagName)?.color || COLORS.primary;
      parts.push(
        <Text
          key={match.index}
          style={[tagStyles.ingredientTag, { backgroundColor: tagColor }]}
        >
          {tagName}({tagDesc})
        </Text>,
      );
    } else {
      // [ingredient(numeric grams)]
      const tagName = match[1];
      const tagWeight = match[2];
      const tagColor = ingredientTags?.find((t) => t.name === tagName)?.color || COLORS.primary;
      parts.push(
        <Text
          key={match.index}
          style={[tagStyles.ingredientTag, { backgroundColor: tagColor }]}
        >
          {tagName}({tagWeight}g)
        </Text>,
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<Text key={`t${lastIndex}`} style={tagStyles.plainText}>{text.slice(lastIndex)}</Text>);
  }

  return <Text>{parts}</Text>;
}

const tagStyles = StyleSheet.create({
  plainText: {
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    lineHeight: 22,
  },
  ingredientTag: {
    color: '#FFFFFF',
    fontWeight: '600',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
    fontSize: 13,
  },
});

export function Stage5CookingContent() {
  const { state } = useCooking();
  const menuProposal = state.session?.stages.menu?.menuProposal;
  const ingredientTags = menuProposal?.ingredientTags;
  const [expandedDishIndex, setExpandedDishIndex] = useState(0);

  const cookingSteps = menuProposal?.cookingSteps;

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

  const groupedDishes = useMemo(() => {
    const map = new Map<string, CookingStep[]>();
    for (const step of cookingSteps) {
      const list = map.get(step.dishName) || [];
      list.push(step);
      map.set(step.dishName, list);
    }
    return [...map.entries()];
  }, [cookingSteps]);

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
                      <InstructionText
                        text={step.instruction}
                        ingredientTags={ingredientTags}
                      />
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
