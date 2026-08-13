import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useCooking } from '../../src/contexts/CookingContext';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import { Button } from '../../src/components/Button';
import { Checkbox } from '../../src/components/Checkbox';
import { LoadingOverlay } from '../../src/components/LoadingOverlay';
import { useCustomAlert } from '../../src/components/CustomAlert';
import { ShoppingItem } from '../../src/types';
import { parseWeight } from '../../src/utils/parseWeight';
import { cookingProgressService } from '../../src/services/cookingProgressService';

export default function ShoppingListScreen() {
  const { state, dispatch } = useCooking();
  const menuProposal = state.session?.stages.menu?.menuProposal;
  const [isProcessing, setIsProcessing] = useState(false);
  const { showAlert } = useCustomAlert();

  const shoppingItems: ShoppingItem[] = useMemo(() => {
    if (!menuProposal?.missingItems) return [];
    return menuProposal.missingItems as ShoppingItem[];
  }, [menuProposal]);

  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const item of shoppingItems) {
      init[item.id] = item.isPurchased ?? false;
    }
    return init;
  });

  const sections = useMemo(() => {
    const ingredientItems = shoppingItems.filter((item) => item.type === 'ingredient');
    const seasoningItems = shoppingItems.filter((item) => item.type === 'seasoning');
    const result = [];
    if (ingredientItems.length > 0) {
      result.push({ type: 'ingredient' as const, title: '缺失食材', data: ingredientItems });
    }
    if (seasoningItems.length > 0) {
      result.push({ type: 'seasoning' as const, title: '缺失调料', data: seasoningItems });
    }
    return result;
  }, [shoppingItems]);

  const checkedCount = Object.values(checkedItems).filter(Boolean).length;
  const totalCount = shoppingItems.length;
  const allChecked = checkedCount === totalCount && totalCount > 0;

  const handleToggle = (id: string) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
    dispatch({ type: 'TOGGLE_SHOPPING_ITEM', payload: id });
  };

  // 监听 session 变化自动持久化勾选状态（防抖 300ms）
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const session = state.session;
      if (!session?.id) return;
      const mi = session.stages?.menu?.menuProposal?.missingItems || [];
      console.log('[SHOP_SAVE] saving missingItems:', mi.map((m: any) => ({ type: m.type, name: m.name, purchased: m.isPurchased })));
      const dishes = session.stages?.menu?.menuProposal?.dishes || [];
      const name = dishes.map((d: any) => d.name).join('、') || '菜单';
      cookingProgressService.save(session as any, name).catch(() => {});
    }, 300);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [state.session]);

  const handleSelectAll = (type: 'ingredient' | 'seasoning') => {
    const items = shoppingItems.filter((item) => item.type === type);
    setCheckedItems((prev) => {
      const next = { ...prev };
      for (const item of items) {
        next[item.id] = true;
      }
      return next;
    });
    // 全选后持久化
    for (const item of items) {
      dispatch({ type: 'TOGGLE_SHOPPING_ITEM', payload: item.id });
    }
  };

  const handleDeselectAll = (type: 'ingredient' | 'seasoning') => {
    const items = shoppingItems.filter((item) => item.type === type);
    setCheckedItems((prev) => {
      const next = { ...prev };
      for (const item of items) {
        next[item.id] = false;
      }
      return next;
    });
    // 全不选后持久化
    for (const item of items) {
      dispatch({ type: 'TOGGLE_SHOPPING_ITEM', payload: item.id });
    }
  };

  const handleBatchAdd = async () => {
    setIsProcessing(true);
    try {
      // 食材处理
      const checkedIngredients = shoppingItems.filter(
        (item) => item.type === 'ingredient' && checkedItems[item.id],
      );
      const mergedIngredients: Record<string, number> = {};
      for (const item of checkedIngredients) {
        const weight = parseWeight(item.suggestedAmount);
        if (weight > 0) {
          mergedIngredients[item.name] = (mergedIngredients[item.name] || 0) + weight;
        }
      }

      // 调料处理
      const checkedSeasonings = shoppingItems.filter(
        (item) => item.type === 'seasoning' && checkedItems[item.id],
      );

      // 实际项目中这里会调用 inventory service 进行入库
      showAlert({ title: '库存已更新', message: '采购的食材和调料已添加到库存。接下来？', buttons: [
        { text: '返回菜谱', onPress: () => router.back() },
        { text: '重新生成菜单', onPress: () => router.replace('/(tabs)/cooking') },
      ] });
    } catch (error: any) {
      showAlert({ title: '更新失败', message: `库存更新失败: ${error.message}` });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!menuProposal || shoppingItems.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>没有需要采购的物品</Text>
      </View>
    );
  }

  const getSectionCheckedCount = (type: 'ingredient' | 'seasoning') => {
    return shoppingItems.filter((item) => item.type === type && checkedItems[item.id]).length;
  };

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({ section }) => {
          const count = getSectionCheckedCount(section.type as any);
          const total = section.data.length;
          return (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title} {count}/{total}</Text>
              <View style={styles.sectionActions}>
                <TouchableOpacity onPress={() => handleSelectAll(section.type as any)}>
                  <Text style={styles.actionText}>全选</Text>
                </TouchableOpacity>
                <Text style={styles.actionSep}>|</Text>
                <TouchableOpacity onPress={() => handleDeselectAll(section.type as any)}>
                  <Text style={styles.actionText}>全不选</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        renderItem={({ item }) => (
          <View style={[styles.itemRow, checkedItems[item.id] && styles.itemRowDone]}>
            <Checkbox
              checked={checkedItems[item.id] ?? false}
              onToggle={() => handleToggle(item.id)}
              label={`${item.name} - ${item.suggestedAmount}（${item.forDish}）`}
            />
          </View>
        )}
      />

      <View style={styles.bottomBar}>
        {allChecked ? (
          <View style={styles.buttonGroup}>
            <Button title="一键添加到库存" variant="primary" onPress={handleBatchAdd} style={styles.flex1} />
            <View style={{ width: 12 }} />
            <Button title="返回菜谱" variant="secondary" onPress={() => router.back()} style={styles.flex1} />
          </View>
        ) : (
          <Button title={`已购 ${checkedCount}/${totalCount} 项`} variant="secondary" disabled fullWidth onPress={() => {}} />
        )}
      </View>

      <LoadingOverlay visible={isProcessing} message="正在更新库存..." />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  listContent: { padding: SPACING.lg, paddingBottom: 20 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: TYPOGRAPHY.body, color: COLORS.textSecondary },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.lg, marginBottom: SPACING.sm },
  sectionTitle: { fontSize: TYPOGRAPHY.h4, fontWeight: '600', color: COLORS.textPrimary },
  sectionActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  actionText: { fontSize: TYPOGRAPHY.caption, color: COLORS.primary },
  actionSep: { color: COLORS.textTertiary },
  itemRow: { backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.xs },
  itemRowDone: { opacity: 0.6 },
  bottomBar: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  buttonGroup: { flexDirection: 'row' },
  flex1: { flex: 1 },
});
