import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useCooking } from '../../src/contexts/CookingContext';
import { useNutrition } from '../../src/contexts/NutritionContext';
import { cookingProgressService } from '../../src/services/cookingProgressService';
import { useInventory } from '../../src/contexts/InventoryContext';
import { COLORS, SEASONING_STATUS_LABEL } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS } from '../../src/constants/spacing';
import { Button } from '../../src/components/Button';
import { useCustomAlert } from '../../src/components/CustomAlert';
import { calculateIngredientSuggestions, calculateSeasoningSuggestions } from '../../src/services/inventoryCalculator';
import { IngredientSuggestion, SeasoningSuggestion } from '../../src/types';

export default function InventoryUpdateScreen() {
  const { state: cookingState, dispatch } = useCooking();
  const { reset: resetNutrition } = useNutrition();
  const { state: invState, addIngredient, updateIngredient, addSeasoning, updateSeasoning } = useInventory();
  const { showAlert } = useCustomAlert();
  const [mode, setMode] = useState<'batch' | 'individual'>('batch');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [ingredientUpdates, setIngredientUpdates] = useState<Record<string, string>>({});
  const [seasoningUpdates, setSeasoningUpdates] = useState<Record<string, string | null>>({});
  const [isSaving, setIsSaving] = useState(false);

  const menuProposal = cookingState.session?.stages.menu?.menuProposal;

  const ingredientSuggestions = useMemo(() => {
    if (!cookingState.session || !menuProposal) return [];
    const input = {
      dishes: menuProposal.dishes.map((d: any) => ({
        name: d.name,
        ingredients: d.ingredients.map((i: any) => ({
          name: i.name,
          actualGrams: i.estimatedWeight, // No weighed data, use the AI-estimated amount
        })),
      })),
      availableSeasonings: [],
      peopleCount: cookingState.session.stages.requirement?.personCount || 2,
      mealType: cookingState.session.stages.requirement?.mealType || 'any',
      calorieTarget: cookingState.session.stages.requirement?.caloriePreference,
    };
    return calculateIngredientSuggestions(input, invState.ingredients);
  }, [menuProposal, invState.ingredients, cookingState.session]);

  const seasoningSuggestions = useMemo(() => {
    const menu = cookingState.session?.stages.menu?.menuProposal;
    if (menu) {
      const names = new Set<string>();
      for (const dish of menu.dishes) {
        for (const s of dish.seasonings) {
          names.add(s.name);
        }
      }
      return calculateSeasoningSuggestions([...names], invState.seasonings);
    }
    return [];
  }, [invState.seasonings, cookingState.session]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      for (const sugg of ingredientSuggestions) {
        const remaining = ingredientUpdates[sugg.ingredientId];
        if (remaining !== undefined) {
          const val = parseFloat(remaining);
          if (!isNaN(val) && sugg.ingredientId.startsWith('_new_')) {
            await addIngredient(sugg.ingredientName, val);
          } else if (!isNaN(val) && sugg.currentStock !== null) {
            await updateIngredient(sugg.ingredientId, { weight: val });
          }
        }
      }
      for (const sugg of seasoningSuggestions) {
        const newStatus = seasoningUpdates[sugg.seasoningId];
        if (newStatus) {
          if (sugg.seasoningId.startsWith('_new_')) {
            await addSeasoning(sugg.seasoningName, newStatus as any);
          } else {
            await updateSeasoning(sugg.seasoningId, { status: newStatus as any });
          }
        }
      }
      setHasUnsavedChanges(false);
      showAlert({
        title: '更新成功',
        message: '库存已更新',
        buttons: [
          {
            text: '返回库存',
            style: 'default',
            onPress: () => {
              dispatch({ type: 'SET_CURRENT_STAGE', payload: 'completed' });
              // Persist the completed state to disk so history can recognize it as "completed"
              if (cookingState.session) {
                cookingProgressService.save(cookingState.session).catch(() => {});
              }
              resetNutrition();
              router.dismissAll();
              router.replace('/(tabs)/cooking');
            },
          },
        ],
      });
    } catch (error: any) {
      showAlert({ title: '更新失败', message: String(error) });
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetAllSeasonings = () => {
    setSeasoningUpdates({});
    setHasUnsavedChanges(true);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>库存更新</Text>

        {/* Mode switch */}
        <View style={styles.modeRow}>
          <Button
            title="批量模式"
            variant={mode === 'batch' ? 'primary' : 'ghost'}
            size="sm"
            onPress={() => setMode('batch')}
          />
          <Button
            title="逐项编辑"
            variant={mode === 'individual' ? 'primary' : 'ghost'}
            size="sm"
            onPress={() => setMode('individual')}
          />
        </View>

        {/* Ingredient updates */}
        <Text style={styles.sectionTitle}>食材消耗</Text>
        {ingredientSuggestions.map((sugg) => (
          <View
            key={sugg.ingredientId}
            style={[
              styles.suggRow,
              !sugg.isSufficient && styles.suggRowNegative,
              sugg.suggestedRemaining === 0 && styles.suggRowZero,
            ]}
          >
            <View style={styles.suggInfo}>
              <Text style={styles.suggName}>{sugg.ingredientName}</Text>
              <Text style={styles.suggDetail}>
                用量 {sugg.usedGrams}g | 库存 {sugg.currentStock ?? '未知'}g
              </Text>
            </View>
            {mode === 'individual' ? (
              <TextInput
                style={styles.suggInput}
                value={ingredientUpdates[sugg.ingredientId] ?? String(sugg.suggestedRemaining ?? '')}
                onChangeText={(v) => {
                  setIngredientUpdates((prev) => ({ ...prev, [sugg.ingredientId]: v }));
                  setHasUnsavedChanges(true);
                }}
                keyboardType="numeric"
              />
            ) : (
              <Text style={[styles.suggRemaining, !sugg.isSufficient && styles.suggRemainingNegative]}>
                {sugg.suggestedRemaining ?? '—'}g
              </Text>
            )}
            {sugg.suggestedRemaining !== null && sugg.suggestedRemaining < 0 && (
              <Text style={styles.warningIcon}>⚠</Text>
            )}
          </View>
        ))}

        {/* Seasoning updates */}
        <Text style={styles.sectionTitle}>调料消耗</Text>
        {seasoningSuggestions.map((sugg) => (
          <View key={sugg.seasoningId} style={styles.suggRow}>
            <View style={styles.suggInfo}>
              <Text style={styles.suggName}>{sugg.seasoningName}</Text>
              <Text style={styles.suggDetail}>
                {SEASONING_STATUS_LABEL[sugg.currentStatus]} →{' '}
                {sugg.suggestedStatus ? SEASONING_STATUS_LABEL[sugg.suggestedStatus] : '不变'}
              </Text>
            </View>
          </View>
        ))}
        {seasoningSuggestions.length > 0 && (
          <Button title="全部不更改" variant="ghost" size="sm" onPress={handleResetAllSeasonings} />
        )}
      </ScrollView>

      <View style={styles.bottomBar}>
        <View style={styles.buttonRow}>
          <Button title="稍后再说" variant="ghost" onPress={() => router.back()} style={styles.flex1} />
          <Button title="确认更新" variant="primary" loading={isSaving} onPress={handleSave} style={styles.flex2} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  title: { fontSize: TYPOGRAPHY.h2, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.md },
  modeRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  sectionTitle: { fontSize: TYPOGRAPHY.h4, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.md, marginTop: SPACING.lg },
  suggRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.xs },
  suggRowNegative: { backgroundColor: '#FFF5F5' },
  suggRowZero: { backgroundColor: '#FFFDE7' },
  suggInfo: { flex: 1 },
  suggName: { fontSize: TYPOGRAPHY.body, fontWeight: '500', color: COLORS.textPrimary },
  suggDetail: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary },
  suggInput: { width: 70, height: 36, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.sm, textAlign: 'center', fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary },
  suggRemaining: { fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.primary },
  suggRemainingNegative: { color: COLORS.danger },
  warningIcon: { fontSize: 18, marginLeft: SPACING.sm },
  bottomBar: { padding: SPACING.lg, paddingBottom: SPACING.xl, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  buttonRow: { flexDirection: 'row' },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
});
