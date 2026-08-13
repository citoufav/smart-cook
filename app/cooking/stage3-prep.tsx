import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCooking } from '../../src/contexts/CookingContext';
import { useNutrition } from '../../src/contexts/NutritionContext';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import { IngredientTag, NutritionalData } from '../../src/types';

/** 修补 AI 输出中不完整的方括号 */
function normalizeBrackets(text: string): string {
  const result = text
    // 碗1] → [碗1]（仅当前面没有 [ 时才修复）
    .replace(/(?<!\[)(碗\d+)\]/g, '[$1]')
    // [清水(120g → [清水(120g)]（仅当 g 后面不是 )] 时才补 ]）
    .replace(/\[([^\]]+\(\d+)g(?!\)\])/g, '[$1g]');
  if (result !== text) {
    console.log('[TAG:PREP] normalizeBrackets 修复 | 输入:', JSON.stringify(text), '| 输出:', JSON.stringify(result));
  }
  return result;
}

/** 解析 description 中的 [食材名(克重)] 标签并渲染为实色标签 */
function IngredientTagText({
  text,
  ingredientTags,
}: {
  text: string;
  ingredientTags?: IngredientTag[];
}) {
  const normalized = normalizeBrackets(text);
  console.log('[TAG:PREP] IngredientTagText 原始:', JSON.stringify(text), '| 修正后:', JSON.stringify(normalized));
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  // 两个分支: 食材(克重) | 食材(非克重描述)
  const regex = /\[(.+?)\((\d+)g\)\]|\[(.+?)\((\S+?)\)\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`t${lastIndex}`} style={tagStyles.plainText}>{normalized.slice(lastIndex, match.index)}</Text>,
      );
    }
    if (match[3]) {
      // 非克重标签: [食材名(少许/适量/X勺)]
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
      // 克重标签: [食材名(数字g)]
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

  if (lastIndex < normalized.length) {
    parts.push(<Text key={`t${lastIndex}`} style={tagStyles.plainText}>{normalized.slice(lastIndex)}</Text>);
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

export function Stage3PrepContent() {
  const { state } = useCooking();
  const { setPreciseNutrition } = useNutrition();
  const personCount = state.session?.stages.requirement?.personCount ?? 1;
  const menuProposal = state.session?.stages.menu?.menuProposal;
  const ingredientTags = menuProposal?.ingredientTags;
  const [expandedDishIndex, setExpandedDishIndex] = useState(0);

  const nutritionShownRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!nutritionShownRef.current && menuProposal?.preciseNutrition) {
        nutritionShownRef.current = true;
        if (menuProposal) {
          const nutritionByDish: Record<string, NutritionalData> = {};
          for (let i = 0; i < menuProposal.dishes.length; i++) {
            const dish = menuProposal.dishes[i];
            if (menuProposal.preciseNutrition[i]) {
              nutritionByDish[dish.name] = {
                ...menuProposal.preciseNutrition[i],
                source: 'precise',
              };
            }
          }
          if (Object.keys(nutritionByDish).length > 0) {
            setPreciseNutrition(nutritionByDish, personCount);
          }
        }
      }
    }, [state.session, menuProposal]),
  );

  const prepSteps = menuProposal?.prepSteps;

  // 按菜品分组备菜步骤
  const groupedPrepSteps = useMemo(() => {
    if (!prepSteps) return [];
    const map = new Map<string, typeof prepSteps>();
    const ungrouped: typeof prepSteps = [];
    for (const step of prepSteps) {
      if (step.dishName) {
        const list = map.get(step.dishName) || [];
        list.push(step);
        map.set(step.dishName, list);
      } else {
        ungrouped.push(step);
      }
    }
    const result = [...map.entries()].map(([dishName, steps]) => ({ dishName, steps }));
    if (ungrouped.length > 0) result.push({ dishName: '通用备菜', steps: ungrouped });
    return result;
  }, [prepSteps]);

  if (!menuProposal || !prepSteps || prepSteps.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>暂无备菜数据</Text>
          {menuProposal && !prepSteps && (
            <Text style={styles.emptyHint}>AI 返回的生成方案中缺少备菜步骤，请返回重新生成</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>切菜备菜</Text>

        {groupedPrepSteps.map((group, dishIndex) => {
          const isExpanded = expandedDishIndex === dishIndex;

          return (
            <View key={group.dishName} style={styles.dishCard}>
              <TouchableOpacity
                style={styles.dishHeader}
                onPress={() => setExpandedDishIndex(isExpanded ? -1 : dishIndex)}
                activeOpacity={0.7}
              >
                <Text style={styles.dishName}>{group.dishName}</Text>
                <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.stepList}>
                  {group.steps.map((step) => (
                    <View key={step.id} style={styles.cardStepRow}>
                      <Text>
                        {step.ingredientName ? (
                          <Text style={styles.ingredientBold}>{step.ingredientName} </Text>
                        ) : null}
                        {step.quantity ? (
                          <Text style={styles.quantityText}>{step.quantity} </Text>
                        ) : null}
                        <IngredientTagText text={step.description} ingredientTags={ingredientTags} />
                      </Text>
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
  groupBlock: { marginBottom: SPACING.md },
  groupTitle: { fontSize: TYPOGRAPHY.h4, fontWeight: '700', color: COLORS.primary, marginBottom: SPACING.sm, marginTop: SPACING.sm },
  progress: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, marginBottom: SPACING.lg },
  dishCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, marginBottom: SPACING.md, ...SHADOWS.sm, overflow: 'hidden' },
  dishHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.lg },
  dishName: { fontSize: TYPOGRAPHY.h4, fontWeight: '700', color: COLORS.textPrimary },
  expandIcon: { fontSize: 12, color: COLORS.textSecondary },
  stepList: { padding: SPACING.lg, paddingTop: 0 },
  stepRow: { backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.sm },
  cardStepRow: { paddingVertical: SPACING.sm },
  stepRowDone: { opacity: 0.6 },
  ingredientBold: { fontSize: TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textPrimary },
  quantityText: { fontSize: TYPOGRAPHY.body, color: COLORS.textSecondary },
  bottomBar: { padding: SPACING.md, paddingBottom: SPACING.sm, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
});
