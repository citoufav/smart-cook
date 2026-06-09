import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  LayoutAnimation,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCooking } from '../../src/contexts/CookingContext';
import { useNutrition } from '../../src/contexts/NutritionContext';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS } from '../../src/constants/spacing';
import { Button } from '../../src/components/Button';
import { Checkbox } from '../../src/components/Checkbox';
import { cookingProgressService } from '../../src/services/cookingProgressService';
import { IngredientTag, NutritionalData, StageMode } from '../../src/types';

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

export default function Stage3PrepScreen() {
  const { state, dispatch } = useCooking();
  const { setPreciseNutrition } = useNutrition();
  const personCount = state.session?.stages.requirement?.personCount ?? 1;
  const params = useLocalSearchParams<{ readonly?: string }>();
  const isReadonly = params.readonly === '1';
  const generatedPlan = state.session?.stages.generatedPlan;
  const ingredientTags = generatedPlan?.ingredientTags;
  const [checkStates, setCheckStates] = useState<Record<string, boolean>>({});

  const nutritionShownRef = useRef(false);

  const allCompletedStages = useMemo(() => {
    if (!isReadonly) return undefined;
    const stages = state.session?.stages;
    const result: string[] = [];
    if (stages?.menu) result.push('menu');
    if (stages?.weighing) result.push('weighing');
    if (stages?.generatedPlan?.prepSteps) result.push('prep');
    if (stages?.generatedPlan?.bowlAssignments) result.push('bowl');
    if (stages?.generatedPlan?.cookingSteps) result.push('cooking');
    return result;
  }, [isReadonly, state.session]);

  useFocusEffect(
    useCallback(() => {
      if (!isReadonly && !nutritionShownRef.current && generatedPlan?.preciseNutrition) {
        nutritionShownRef.current = true;
        const menuProposal = state.session?.stages.menu?.menuProposal;
        if (menuProposal) {
          const nutritionByDish: Record<string, NutritionalData> = {};
          for (let i = 0; i < menuProposal.dishes.length; i++) {
            const dish = menuProposal.dishes[i];
            if (generatedPlan.preciseNutrition[i]) {
              nutritionByDish[dish.name] = {
                ...generatedPlan.preciseNutrition[i],
                source: 'precise',
              };
            }
          }
          if (Object.keys(nutritionByDish).length > 0) {
            setPreciseNutrition(nutritionByDish, personCount);
          }
        }
      }
      if (state.session && !isReadonly) {
        cookingProgressService.save(state.session).catch(() => {});
      }
    }, [state.session, isReadonly, generatedPlan]),
  );

  const prepSteps = generatedPlan?.prepSteps;

  if (!generatedPlan || !prepSteps || prepSteps.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>暂无备菜数据</Text>
          {generatedPlan && !prepSteps && (
            <Text style={styles.emptyHint}>AI 返回的生成方案中缺少备菜步骤，请返回重新生成</Text>
          )}
        </View>
        {/* CookingProgressBar 移至全局 Pager */}
      </View>
    );
  }

  const completedCount = Object.values(checkStates).filter(Boolean).length;
  const totalCount = prepSteps.length;
  const allDone = completedCount === totalCount;

  const handleToggle = (stepId: string) => {
    if (isReadonly) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCheckStates((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  const handleComplete = () => {
    dispatch({ type: 'COMPLETE_ALL_PREP' });
    router.push('/cooking/stage4-bowl');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>切菜备菜</Text>
        {!isReadonly && (
          <Text style={styles.progress}>已完成 {completedCount}/{totalCount}</Text>
        )}

        {prepSteps.map((step) => {
          const isDone = isReadonly ? (step.isCompleted ?? false) : (checkStates[step.id] ?? false);
          return (
            <View key={step.id} style={[styles.stepRow, isDone && styles.stepRowDone]}>
              <Checkbox
                checked={isDone}
                onToggle={() => handleToggle(step.id)}
                disabled={isReadonly}
                labelContent={
                  <Text>
                    {step.ingredientName ? (
                      <Text style={styles.ingredientBold}>{step.ingredientName} </Text>
                    ) : null}
                    {step.quantity ? (
                      <Text style={styles.quantityText}>{step.quantity} </Text>
                    ) : null}
                    <IngredientTagText text={step.description} ingredientTags={ingredientTags} />
                  </Text>
                }
              />
            </View>
          );
        })}
      </ScrollView>

      {!isReadonly && (
        <View style={styles.bottomBar}>
          <Button
            title={allDone ? '备菜完成，开始分装' : `已完成 ${completedCount}/${totalCount}`}
            variant={allDone ? 'primary' : 'secondary'}
            size="lg"
            fullWidth
            disabled={!allDone}
            onPress={handleComplete}
          />
        </View>
      )}
      {/* CookingProgressBar 移至全局 Pager */}
    </View>
  );
}

interface Stage3PrepContentProps {
  mode: StageMode;
  onComplete?: () => void;
}

export function Stage3PrepContent({ mode, onComplete }: Stage3PrepContentProps) {
  const { state, dispatch } = useCooking();
  const { setPreciseNutrition } = useNutrition();
  const personCount = state.session?.stages.requirement?.personCount ?? 1;
  const isReadonly = mode === 'readonly';
  const generatedPlan = state.session?.stages.generatedPlan;
  const ingredientTags = generatedPlan?.ingredientTags;
  const [checkStates, setCheckStates] = useState<Record<string, boolean>>({});

  const nutritionShownRef = useRef(false);

  const allCompletedStages = useMemo(() => {
    if (!isReadonly) return undefined;
    const stages = state.session?.stages;
    const result: string[] = [];
    if (stages?.menu) result.push('menu');
    if (stages?.weighing) result.push('weighing');
    if (stages?.generatedPlan?.prepSteps) result.push('prep');
    if (stages?.generatedPlan?.bowlAssignments) result.push('bowl');
    if (stages?.generatedPlan?.cookingSteps) result.push('cooking');
    return result;
  }, [isReadonly, state.session]);

  useFocusEffect(
    useCallback(() => {
      if (!isReadonly && !nutritionShownRef.current && generatedPlan?.preciseNutrition) {
        nutritionShownRef.current = true;
        const menuProposal = state.session?.stages.menu?.menuProposal;
        if (menuProposal) {
          const nutritionByDish: Record<string, NutritionalData> = {};
          for (let i = 0; i < menuProposal.dishes.length; i++) {
            const dish = menuProposal.dishes[i];
            if (generatedPlan.preciseNutrition[i]) {
              nutritionByDish[dish.name] = {
                ...generatedPlan.preciseNutrition[i],
                source: 'precise',
              };
            }
          }
          if (Object.keys(nutritionByDish).length > 0) {
            setPreciseNutrition(nutritionByDish, personCount);
          }
        }
      }
      if (state.session && mode === 'interactive') {
        cookingProgressService.save(state.session).catch(() => {});
      }
    }, [state.session, mode, isReadonly, generatedPlan]),
  );

  const prepSteps = generatedPlan?.prepSteps;

  if (!generatedPlan || !prepSteps || prepSteps.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>暂无备菜数据</Text>
          {generatedPlan && !prepSteps && (
            <Text style={styles.emptyHint}>AI 返回的生成方案中缺少备菜步骤，请返回重新生成</Text>
          )}
        </View>
      </View>
    );
  }

  const completedCount = Object.values(checkStates).filter(Boolean).length;
  const totalCount = prepSteps.length;
  const allDone = completedCount === totalCount;

  const handleToggle = (stepId: string) => {
    if (isReadonly) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCheckStates((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  const handleComplete = () => {
    dispatch({ type: 'COMPLETE_ALL_PREP' });
    onComplete?.();
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>切菜备菜</Text>
        {!isReadonly && (
          <Text style={styles.progress}>已完成 {completedCount}/{totalCount}</Text>
        )}

        {prepSteps.map((step) => {
          const isDone = checkStates[step.id] ?? false;
          return (
            <View key={step.id} style={[styles.stepRow, isDone && styles.stepRowDone]}>
              <Checkbox
                checked={isDone}
                onToggle={() => handleToggle(step.id)}
                labelContent={
                  <Text>
                    {step.ingredientName ? (
                      <Text style={styles.ingredientBold}>{step.ingredientName} </Text>
                    ) : null}
                    {step.quantity ? (
                      <Text style={styles.quantityText}>{step.quantity} </Text>
                    ) : null}
                    <IngredientTagText text={step.description} ingredientTags={ingredientTags} />
                  </Text>
                }
              />
            </View>
          );
        })}
      </ScrollView>

      {!isReadonly && (
        <View style={styles.bottomBar}>
          <Button
            title={allDone ? '备菜完成，开始分装' : `已完成 ${completedCount}/${totalCount}`}
            variant={allDone ? 'primary' : 'secondary'}
            size="lg"
            fullWidth
            disabled={!allDone}
            onPress={handleComplete}
          />
        </View>
      )}
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
  stepRow: { backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.sm },
  stepRowDone: { opacity: 0.6 },
  ingredientBold: { fontSize: TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textPrimary },
  quantityText: { fontSize: TYPOGRAPHY.body, color: COLORS.textSecondary },
  bottomBar: { padding: SPACING.md, paddingBottom: SPACING.sm, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
});
