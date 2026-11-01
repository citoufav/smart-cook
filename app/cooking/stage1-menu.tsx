import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCooking } from '../../src/contexts/CookingContext';
import { useNutrition } from '../../src/contexts/NutritionContext';
import { useInventory } from '../../src/contexts/InventoryContext';
import { useCustomAlert } from '../../src/components/CustomAlert';
import { MenuProposal, DishPlan, NutritionalData } from '../../src/types';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS } from '../../src/constants/spacing';
import { Card } from '../../src/components/Card';
import { applyEdits, hasFullDensity, MenuEdit } from '../../src/services/menuEditService';
import { cookingProgressService } from '../../src/services/cookingProgressService';
import { DishEditorSheet, AddDishSheet } from '../../src/components/DishSheets';

export function Stage1MenuContent() {
  const { state, dispatch } = useCooking();
  const { setPreciseNutrition, setEstimatedNutrition } = useNutrition();
  const inventoryState = useInventory().state;
  const { showAlert } = useCustomAlert();
  const [showReasoning, setShowReasoning] = useState(false);
  const [editingDish, setEditingDish] = useState<DishPlan | null>(null);
  const [addingDish, setAddingDish] = useState(false);

  const session = state.session;
  const menuProposal: MenuProposal | undefined = session?.stages.menu?.menuProposal;
  const requirement = session?.stages.requirement;
  const reasoningContent: string = session?.stages.menu?.reasoningContent || '';

  /** 把改动落进 session、同步营养面板，并写回本地记录 */
  const commitMenu = useCallback(
    (nextMenu: MenuProposal) => {
      if (!session) return;
      dispatch({ type: 'UPDATE_PLAN', payload: { menuProposal: nextMenu } });

      const personCount = requirement?.personCount ?? 1;
      const byDish: Record<string, NutritionalData> = {};
      for (const d of nextMenu.dishes) {
        byDish[d.name] = { ...d.estimatedNutrition, source: hasFullDensity(d) ? 'precise' : 'estimated' };
      }
      if (Object.keys(byDish).length > 0) {
        if (nextMenu.dishes.some((d) => hasFullDensity(d))) {
          setPreciseNutrition(byDish, personCount);
        } else {
          setEstimatedNutrition(byDish, personCount);
        }
      }

      const name = nextMenu.dishes.map((d) => d.name).join('、') || '菜单';
      cookingProgressService
        .save(
          {
            ...session,
            stages: { ...session.stages, menu: { ...session.stages.menu!, menuProposal: nextMenu } },
          } as any,
          name,
        )
        .catch(() => {});
    },
    [session, requirement, dispatch, setPreciseNutrition, setEstimatedNutrition],
  );

  const runEdits = useCallback(
    (edits: MenuEdit[]) => {
      if (!menuProposal || !requirement || edits.length === 0) return;
      const nextMenu = applyEdits(menuProposal, requirement, edits, {
        inventoryNames: inventoryState.ingredients.map((i) => i.name),
      });
      commitMenu(nextMenu);
    },
    [menuProposal, requirement, inventoryState.ingredients, commitMenu],
  );

  const handleSaveDish = useCallback(
    (edits: MenuEdit[]) => {
      setEditingDish(null);
      runEdits(edits);
    },
    [runEdits],
  );

  const handleDeleteDish = useCallback(
    (dish: DishPlan) => {
      showAlert({
        title: `删掉「${dish.name}」？`,
        message: '这道菜的食材、调料、备菜和炒制步骤会一起删掉，采购清单也会重新算。',
        buttons: [
          { text: '取消', style: 'cancel' },
          {
            text: '删掉',
            style: 'destructive',
            onPress: () => runEdits([{ op: 'remove_dish', dish: dish.name }]),
          },
        ],
      });
    },
    [showAlert, runEdits],
  );

  const handleAddDish = useCallback(
    (dish: DishPlan) => {
      setAddingDish(false);
      runEdits([{ op: 'add_dish', generated: dish }]);
    },
    [runEdits],
  );

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
        {/* AI summary */}
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

        {/* AI reasoning (collapsible) */}
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

        {/* Missing-items reminder — placed between the AI summary and the dish list */}
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

        {/* Dish list — 每道菜一张卡片，改和删都在卡片上 */}
        <Card title={`菜品清单（${menuProposal.dishes.length} 道）`}>
          {menuProposal.dishes.length === 0 && (
            <Text style={styles.emptyDishesText}>
              还没有菜品。点下面的「加一道菜」让 AI 想一道，或查看采购清单补齐食材。
            </Text>
          )}

          {menuProposal.dishes.map((dish, index) => (
            <View key={dish.id} style={styles.dishBlock}>
              <View style={styles.dishHeader}>
                <View style={styles.dishNumber}>
                  <Text style={styles.dishNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.dishName} numberOfLines={2}>{dish.name}</Text>
                <TouchableOpacity
                  style={styles.dishAction}
                  onPress={() => setEditingDish(dish)}
                  hitSlop={8}
                  accessibilityLabel={`编辑 ${dish.name}`}
                >
                  <Ionicons name="create-outline" size={20} color={COLORS.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.dishAction}
                  onPress={() => handleDeleteDish(dish)}
                  hitSlop={8}
                  accessibilityLabel={`删除 ${dish.name}`}
                >
                  <Ionicons name="trash-outline" size={19} color={COLORS.danger} />
                </TouchableOpacity>
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

              {dish.seasonings.length > 0 && (
                <View style={styles.seasoningList}>
                  {dish.seasonings.map((s) => (
                    <View key={s.name} style={styles.seasoningRow}>
                      <Text style={styles.seasoningName}>{s.name}</Text>
                      <Text style={styles.seasoningAmount}>{s.amount}</Text>
                    </View>
                  ))}
                </View>
              )}

              {dish.estimatedNutrition && (
                <View style={styles.nutritionMini}>
                  <Text style={styles.nutritionMiniText}>
                    {dish.estimatedNutrition.calories}大卡 | 蛋白{dish.estimatedNutrition.protein}g | 脂肪{dish.estimatedNutrition.fat}g | 碳水{dish.estimatedNutrition.carbs}g
                  </Text>
                </View>
              )}
            </View>
          ))}

          <TouchableOpacity style={styles.addDishBtn} onPress={() => setAddingDish(true)} activeOpacity={0.7}>
            <Ionicons name="add" size={18} color={COLORS.primary} />
            <Text style={styles.addDishText}>加一道菜</Text>
          </TouchableOpacity>
        </Card>

        {/* Estimated nutrition */}
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

      <DishEditorSheet
        visible={!!editingDish}
        dish={editingDish}
        onClose={() => setEditingDish(null)}
        onSave={handleSaveDish}
      />
      <AddDishSheet visible={addingDish} onClose={() => setAddingDish(false)} onAdd={handleAddDish} />
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
  dishName: { flex: 1, fontSize: TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textPrimary },
  dishAction: { paddingLeft: SPACING.sm },
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
  addDishBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
  },
  addDishText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.primary, fontWeight: '600' },
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
  // AI reasoning
  reasoningSection: { backgroundColor: '#F0F4FF', borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.md, overflow: 'hidden' },
  reasoningHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md },
  reasoningTitle: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.primary },
  reasoningHint: { fontSize: 11, color: COLORS.textTertiary },
  reasoningContent: { maxHeight: 250, paddingHorizontal: SPACING.md, paddingBottom: SPACING.md },
  reasoningText: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  emptyDishesText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, lineHeight: 20, marginBottom: SPACING.md },
});

export default Stage1MenuContent;
