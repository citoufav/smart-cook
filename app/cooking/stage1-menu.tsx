import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCooking } from '../../src/contexts/CookingContext';
import { useNutrition } from '../../src/contexts/NutritionContext';
import { MenuProposal, DishPlan, StageMode } from '../../src/types';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { useSafeJsonParam } from '../../src/hooks/useSafeJsonParam';
import { RequirementInput } from '../../src/types';

export default function Stage1MenuScreen() {
  const { state, setCurrentStage } = useCooking();
  const { state: nutritionState } = useNutrition();
  const params = useLocalSearchParams<{ readonly?: string }>();
  const isReadonly = params.readonly === '1';
  const requirement = useSafeJsonParam<RequirementInput>('requirement');
  const [showReasoning, setShowReasoning] = useState(false);

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

  const menuProposal: MenuProposal | undefined = state.session?.stages.menu?.menuProposal;
  const reasoningContent: string = state.session?.stages.menu?.reasoningContent || '';

  if (!menuProposal) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>暂无菜单数据</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>返回输入需求</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleConfirm = () => {
    setCurrentStage('weighing');
    router.push('/cooking/stage2-weighing');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* AI 摘要 */}
        {menuProposal.summary && (
          <Card title="AI 推荐">
            <Text style={styles.summaryText}>{menuProposal.summary.description}</Text>
            {menuProposal.summary.cookingOrder && (
              <Text style={styles.orderText}>
                {'\n'}制作顺序：{menuProposal.summary.cookingOrder}
              </Text>
            )}
            {menuProposal.summary.flavorNotes && (
              <Text style={styles.flavorText}>
                {'\n'}风味特点：{menuProposal.summary.flavorNotes}
              </Text>
            )}
          </Card>
        )}

        {/* AI 思考过程（可折叠） */}
        {reasoningContent ? (
          <View style={styles.reasoningSection}>
            <TouchableOpacity
              style={styles.reasoningHeader}
              onPress={() => setShowReasoning(!showReasoning)}
              activeOpacity={0.7}
            >
              <Text style={styles.reasoningTitle}>
                {showReasoning ? '▼' : '▶'} AI 思考过程
              </Text>
              <Text style={styles.reasoningHint}>点击查看</Text>
            </TouchableOpacity>
            {showReasoning && (
              <ScrollView style={styles.reasoningContent} nestedScrollEnabled>
                <Text style={styles.reasoningText}>{reasoningContent}</Text>
              </ScrollView>
            )}
          </View>
        ) : null}

        {/* 菜品清单 */}
        {menuProposal.dishes.length === 0 ? (
          <View style={styles.emptyDishesAlert}>
            <Text style={styles.emptyDishesTitle}>暂无可搭配的完整菜品</Text>
            <Text style={styles.emptyDishesText}>
              当前食材较少，AI 暂未生成完整菜品。请查看下方的采购建议，前往采购后再试。
            </Text>
            {menuProposal.missingItems.length > 0 && (
              <TouchableOpacity
                style={styles.shoppingBtn}
                onPress={() => router.push('/cooking/shopping-list')}
              >
                <Text style={styles.shoppingBtnText}>查看采购清单 →</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <Card title={`菜品清单（${menuProposal.dishes.length} 道）`}>
          {menuProposal.dishes.map((dish: DishPlan, index: number) => (
            <View key={dish.name} style={styles.dishBlock}>
              <View style={styles.dishHeader}>
                <View style={styles.dishNumber}>
                  <Text style={styles.dishNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.dishName}>{dish.name}</Text>
              </View>
              <View style={styles.ingredientList}>
                {dish.ingredients.map((ing) => (
                  <View key={ing.name} style={styles.ingredientRow}>
                    <Text style={styles.ingredientName}>{ing.name}</Text>
                    <Text style={styles.ingredientWeight}>{ing.estimatedWeight}g</Text>
                    {!ing.isInInventory && (
                      <View style={styles.needBuyTag}>
                        <Text style={styles.needBuyText}>需购买</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
              <View style={styles.seasoningList}>
                {dish.seasonings.map((s) => (
                  <View key={s.name} style={styles.seasoningRow}>
                    <Text style={styles.seasoningName}>{s.name}</Text>
                    <Text style={styles.seasoningAmount}>{s.amount}</Text>
                  </View>
                ))}
              </View>
              {dish.estimatedNutrition && (
                <View style={styles.nutritionMini}>
                  <Text style={styles.nutritionMiniText}>
                    {dish.estimatedNutrition.calories}大卡 | 蛋白{dish.estimatedNutrition.protein}g | 脂肪{dish.estimatedNutrition.fat}g | 碳水{dish.estimatedNutrition.carbs}g
                  </Text>
                </View>
              )}
            </View>
          ))}
        </Card>
        )}

        {/* 缺失清单提醒 */}
        {menuProposal.missingItems.length > 0 && (
          <View style={styles.missingAlert}>
            <Text style={styles.missingTitle}>⚠ 以下食材/调料库存不足：</Text>
            {menuProposal.missingItems.map((item) => (
              <Text key={item.id} style={styles.missingItem}>
                · {item.type === 'ingredient' ? '食材' : '调料'} {item.name} - {item.suggestedAmount}（用于 {item.forDish}）
              </Text>
            ))}
            <TouchableOpacity
              style={styles.shoppingBtn}
              onPress={() => router.push('/cooking/shopping-list')}
            >
              <Text style={styles.shoppingBtnText}>查看采购清单 →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 营养初估 */}
        <Card title="营养成分（初估）">
          <Text style={styles.nutritionNote}>基于 AI 估算用量，称量后将更新为精确值</Text>
          <View style={styles.nutritionGrid}>
            <View style={styles.nutritionItem}>
              <Text style={styles.nutritionValue}>{menuProposal.estimatedNutrition.calories}</Text>
              <Text style={styles.nutritionUnit}>大卡</Text>
            </View>
            <View style={styles.nutritionItem}>
              <Text style={styles.nutritionValue}>{menuProposal.estimatedNutrition.protein}</Text>
              <Text style={styles.nutritionUnit}>蛋白质g</Text>
            </View>
            <View style={styles.nutritionItem}>
              <Text style={styles.nutritionValue}>{menuProposal.estimatedNutrition.fat}</Text>
              <Text style={styles.nutritionUnit}>脂肪g</Text>
            </View>
            <View style={styles.nutritionItem}>
              <Text style={styles.nutritionValue}>{menuProposal.estimatedNutrition.carbs}</Text>
              <Text style={styles.nutritionUnit}>碳水g</Text>
            </View>
          </View>
        </Card>
      </ScrollView>

      {/* 底部按钮 */}
      {!isReadonly && (
        <View style={styles.bottomBar}>
          <Button title="返回修改" variant="secondary" onPress={() => router.back()} style={styles.flex1} />
          <View style={{ width: 12 }} />
          <Button title="确认菜单，开始称量" variant="primary" onPress={handleConfirm} style={styles.flex2} />
        </View>
      )}

      {/* CookingProgressBar 移至全局 Pager */}
    </View>
  );
}

interface Stage1MenuContentProps {
  mode: StageMode;
  onComplete?: () => void;
}

export function Stage1MenuContent({ mode, onComplete }: Stage1MenuContentProps) {
  const { state, setCurrentStage } = useCooking();
  const { state: nutritionState } = useNutrition();
  const requirement = useSafeJsonParam<RequirementInput>('requirement');
  const [showReasoning, setShowReasoning] = useState(false);
  const isReadonly = mode === 'readonly';

  const menuProposal: MenuProposal | undefined = state.session?.stages.menu?.menuProposal;
  const reasoningContent: string = state.session?.stages.menu?.reasoningContent || '';

  if (!menuProposal) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>暂无菜单数据</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>返回输入需求</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* AI 摘要 */}
        {menuProposal.summary && (
          <Card title="AI 推荐">
            <Text style={styles.summaryText}>{menuProposal.summary.description}</Text>
            {menuProposal.summary.cookingOrder && (
              <Text style={styles.orderText}>
                {'\n'}制作顺序：{menuProposal.summary.cookingOrder}
              </Text>
            )}
            {menuProposal.summary.flavorNotes && (
              <Text style={styles.flavorText}>
                {'\n'}风味特点：{menuProposal.summary.flavorNotes}
              </Text>
            )}
          </Card>
        )}

        {/* AI 思考过程（可折叠） */}
        {reasoningContent ? (
          <View style={styles.reasoningSection}>
            <TouchableOpacity
              style={styles.reasoningHeader}
              onPress={() => setShowReasoning(!showReasoning)}
              activeOpacity={0.7}
            >
              <Text style={styles.reasoningTitle}>
                {showReasoning ? '▼' : '▶'} AI 思考过程
              </Text>
              <Text style={styles.reasoningHint}>点击查看</Text>
            </TouchableOpacity>
            {showReasoning && (
              <ScrollView style={styles.reasoningContent} nestedScrollEnabled>
                <Text style={styles.reasoningText}>{reasoningContent}</Text>
              </ScrollView>
            )}
          </View>
        ) : null}

        {/* 菜品清单 */}
        {menuProposal.dishes.length === 0 ? (
          <View style={styles.emptyDishesAlert}>
            <Text style={styles.emptyDishesTitle}>暂无可搭配的完整菜品</Text>
            <Text style={styles.emptyDishesText}>
              当前食材较少，AI 暂未生成完整菜品。请查看下方的采购建议，前往采购后再试。
            </Text>
            {menuProposal.missingItems.length > 0 && (
              <TouchableOpacity
                style={styles.shoppingBtn}
                onPress={() => router.push('/cooking/shopping-list')}
              >
                <Text style={styles.shoppingBtnText}>查看采购清单 →</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <Card title={`菜品清单（${menuProposal.dishes.length} 道）`}>
          {menuProposal.dishes.map((dish: DishPlan, index: number) => (
            <View key={dish.name} style={styles.dishBlock}>
              <View style={styles.dishHeader}>
                <View style={styles.dishNumber}>
                  <Text style={styles.dishNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.dishName}>{dish.name}</Text>
              </View>
              <View style={styles.ingredientList}>
                {dish.ingredients.map((ing) => (
                  <View key={ing.name} style={styles.ingredientRow}>
                    <Text style={styles.ingredientName}>{ing.name}</Text>
                    <Text style={styles.ingredientWeight}>{ing.estimatedWeight}g</Text>
                    {!ing.isInInventory && (
                      <View style={styles.needBuyTag}>
                        <Text style={styles.needBuyText}>需购买</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
              <View style={styles.seasoningList}>
                {dish.seasonings.map((s) => (
                  <View key={s.name} style={styles.seasoningRow}>
                    <Text style={styles.seasoningName}>{s.name}</Text>
                    <Text style={styles.seasoningAmount}>{s.amount}</Text>
                  </View>
                ))}
              </View>
              {dish.estimatedNutrition && (
                <View style={styles.nutritionMini}>
                  <Text style={styles.nutritionMiniText}>
                    {dish.estimatedNutrition.calories}大卡 | 蛋白{dish.estimatedNutrition.protein}g | 脂肪{dish.estimatedNutrition.fat}g | 碳水{dish.estimatedNutrition.carbs}g
                  </Text>
                </View>
              )}
            </View>
          ))}
        </Card>
        )}

        {/* 缺失清单提醒 */}
        {menuProposal.missingItems.length > 0 && (
          <View style={styles.missingAlert}>
            <Text style={styles.missingTitle}>⚠ 以下食材/调料库存不足：</Text>
            {menuProposal.missingItems.map((item) => (
              <Text key={item.id} style={styles.missingItem}>
                · {item.type === 'ingredient' ? '食材' : '调料'} {item.name} - {item.suggestedAmount}（用于 {item.forDish}）
              </Text>
            ))}
            <TouchableOpacity
              style={styles.shoppingBtn}
              onPress={() => router.push('/cooking/shopping-list')}
            >
              <Text style={styles.shoppingBtnText}>查看采购清单 →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 营养初估 */}
        <Card title="营养成分（初估）">
          <Text style={styles.nutritionNote}>基于 AI 估算用量，称量后将更新为精确值</Text>
          <View style={styles.nutritionGrid}>
            <View style={styles.nutritionItem}>
              <Text style={styles.nutritionValue}>{menuProposal.estimatedNutrition.calories}</Text>
              <Text style={styles.nutritionUnit}>大卡</Text>
            </View>
            <View style={styles.nutritionItem}>
              <Text style={styles.nutritionValue}>{menuProposal.estimatedNutrition.protein}</Text>
              <Text style={styles.nutritionUnit}>蛋白质g</Text>
            </View>
            <View style={styles.nutritionItem}>
              <Text style={styles.nutritionValue}>{menuProposal.estimatedNutrition.fat}</Text>
              <Text style={styles.nutritionUnit}>脂肪g</Text>
            </View>
            <View style={styles.nutritionItem}>
              <Text style={styles.nutritionValue}>{menuProposal.estimatedNutrition.carbs}</Text>
              <Text style={styles.nutritionUnit}>碳水g</Text>
            </View>
          </View>
        </Card>
      </ScrollView>

      {/* 底部按钮 */}
      {!isReadonly && (
        <View style={styles.bottomBar}>
          <Button title="返回修改" variant="secondary" onPress={() => router.back()} style={styles.flex1} />
          <View style={{ width: 12 }} />
          <Button title="确认菜单，开始称量" variant="primary" onPress={() => { setCurrentStage('weighing'); onComplete?.(); }} style={styles.flex2} />
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
  backLink: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.primary, marginTop: SPACING.md },
  summaryText: { fontSize: TYPOGRAPHY.body, color: COLORS.textBody, lineHeight: 22 },
  orderText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, lineHeight: 20 },
  flavorText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, lineHeight: 20 },
  dishBlock: { marginBottom: SPACING.lg, backgroundColor: COLORS.neutralLight, borderRadius: BORDER_RADIUS.md, padding: SPACING.md },
  dishHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm },
  dishNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginRight: SPACING.sm },
  dishNumberText: { fontSize: 13, fontWeight: '700', color: COLORS.textWhite },
  dishName: { fontSize: TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textPrimary },
  ingredientList: { marginLeft: 32 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  ingredientName: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textBody, flex: 1 },
  ingredientWeight: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.primary, fontWeight: '600', marginRight: SPACING.sm },
  needBuyTag: { backgroundColor: COLORS.warningLight, paddingHorizontal: 6, paddingVertical: 1, borderRadius: BORDER_RADIUS.sm },
  needBuyText: { fontSize: 11, color: COLORS.warningText },
  seasoningList: { marginLeft: 32, marginTop: SPACING.xs },
  seasoningRow: { flexDirection: 'row', paddingVertical: 1 },
  seasoningName: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, flex: 1 },
  seasoningAmount: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary },
  nutritionMini: { marginLeft: 32, marginTop: SPACING.xs },
  nutritionMiniText: { fontSize: 12, color: COLORS.textTertiary },
  missingAlert: { backgroundColor: '#FFF8E1', borderLeftWidth: 3, borderLeftColor: COLORS.warning, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.md },
  missingTitle: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.warningText, marginBottom: SPACING.xs },
  missingItem: { fontSize: TYPOGRAPHY.caption, color: COLORS.warningText, marginBottom: 2 },
  shoppingBtn: { marginTop: SPACING.sm, alignSelf: 'flex-end' },
  shoppingBtnText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.primary, fontWeight: '600' },
  nutritionNote: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginBottom: SPACING.md },
  nutritionGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  nutritionItem: { width: '48%', alignItems: 'center', padding: SPACING.md, backgroundColor: COLORS.neutralLight, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.sm, marginRight: '2%' },
  nutritionValue: { fontSize: TYPOGRAPHY.h3, fontWeight: '700', color: COLORS.primary },
  nutritionUnit: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary },
  bottomBar: { flexDirection: 'row', padding: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  // AI 思考过程
  reasoningSection: { backgroundColor: '#F0F4FF', borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.md, overflow: 'hidden' },
  reasoningHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md },
  reasoningTitle: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.primary },
  reasoningHint: { fontSize: 11, color: COLORS.textTertiary },
  reasoningContent: { maxHeight: 250, paddingHorizontal: SPACING.md, paddingBottom: SPACING.md },
  reasoningText: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  // 空菜品警告
  emptyDishesAlert: { backgroundColor: '#FFF3E0', borderRadius: BORDER_RADIUS.md, padding: SPACING.lg, marginBottom: SPACING.md, borderLeftWidth: 3, borderLeftColor: COLORS.warning },
  emptyDishesTitle: { fontSize: TYPOGRAPHY.body, fontWeight: '700', color: COLORS.warningText, marginBottom: SPACING.sm },
  emptyDishesText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, lineHeight: 20, marginBottom: SPACING.md },
});
