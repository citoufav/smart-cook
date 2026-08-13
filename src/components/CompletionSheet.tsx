import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCooking } from '../contexts/CookingContext';
import { useInventory } from '../contexts/InventoryContext';
import { cookingProgressService } from '../services/cookingProgressService';
import { SeasoningStatus } from '../types';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';

const SEASONING_STATUS_ORDER: SeasoningStatus[] = ['sufficient', 'low', 'out'];
const SEASONING_STATUS_COLORS: Record<SeasoningStatus, string> = {
  sufficient: '#2D9F4E',
  low: '#FF9800',
  out: '#E53935',
};
const SEASONING_STATUS_LABELS: Record<SeasoningStatus, string> = {
  sufficient: '充足',
  low: '不足',
  out: '用完',
};

interface IngredientConsumption {
  inventoryId: string;
  name: string;
  type: 'ingredient' | 'seasoning';
  originalWeight: number | null;
  consumedWeight: number;
  remainingWeight: number | null;
  isNegative: boolean;
  deleted: boolean;
  seasoningStatus?: SeasoningStatus;
}

interface CompletionSheetProps {
  visible: boolean;
  onClose: () => void;
}

export default function CompletionSheet({ visible, onClose }: CompletionSheetProps) {
  const { state: cookingState } = useCooking();
  const { state: inventoryState, updateIngredient, deleteIngredient, updateSeasoning, deleteSeasoning } = useInventory();
  const insets = useSafeAreaInsets();

  const consumptions = useMemo(() => {
    const session = cookingState.session;
    if (!session) return [];
    const dishes = session.stages.menu?.menuProposal?.dishes || [];

    // 汇总食材用量
    const usageMap = new Map<string, { name: string; totalWeight: number }>();
    for (const dish of dishes) {
      for (const ing of dish.ingredients || []) {
        const existing = usageMap.get(ing.name);
        if (existing) {
          existing.totalWeight += ing.estimatedWeight || 0;
        } else {
          usageMap.set(ing.name, { name: ing.name, totalWeight: ing.estimatedWeight || 0 });
        }
      }
    }

    const result: IngredientConsumption[] = [];
    // 食材
    for (const [, usage] of usageMap) {
      const inventoryItem = inventoryState.ingredients.find((i) => i.name === usage.name);
      const originalWeight = inventoryItem?.weight ?? null;
      const consumedWeight = usage.totalWeight;
      let remainingWeight: number | null = null;
      let isNegative = false;
      if (originalWeight !== null) {
        remainingWeight = originalWeight - consumedWeight;
        isNegative = remainingWeight <= 0;
      }
      result.push({
        inventoryId: inventoryItem?.id || '',
        name: usage.name,
        type: 'ingredient',
        originalWeight,
        consumedWeight,
        remainingWeight,
        isNegative,
        deleted: false,
      });
    }
    // 调料
    const seasoningNames = new Set<string>();
    for (const dish of dishes) {
      for (const s of dish.seasonings || []) {
        seasoningNames.add(s.name);
      }
    }
    for (const name of seasoningNames) {
      const inventoryItem = inventoryState.seasonings.find((s) => s.name === name);
      result.push({
        inventoryId: inventoryItem?.id || '',
        name,
        type: 'seasoning',
        originalWeight: null,
        consumedWeight: 0,
        remainingWeight: null,
        isNegative: false,
        deleted: false,
        seasoningStatus: inventoryItem?.status || 'sufficient',
      });
    }

    // 排序：红色项靠前
    result.sort((a, b) => {
      if (a.isNegative && !b.isNegative) return -1;
      if (!a.isNegative && b.isNegative) return 1;
      return 0;
    });
    return result;
  }, [cookingState.session, inventoryState.ingredients, inventoryState.seasonings]);

  const [items, setItems] = useState<IngredientConsumption[]>(consumptions);
  const [confirmed, setConfirmed] = useState(false);

  React.useEffect(() => {
    if (!confirmed) {
      setItems(consumptions);
    }
  }, [consumptions, confirmed]);

  const toggleDelete = useCallback((name: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.name === name ? { ...it, deleted: !it.deleted } : it,
      ),
    );
  }, []);

  const toggleSeasoningStatus = useCallback((name: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.name !== name) return it;
        const currentIdx = SEASONING_STATUS_ORDER.indexOf(it.seasoningStatus || 'sufficient');
        const nextIdx = (currentIdx + 1) % 3;
        return { ...it, seasoningStatus: SEASONING_STATUS_ORDER[nextIdx] };
      }),
    );
  }, []);

  const handleConfirm = useCallback(async () => {
    for (const item of items) {
      if (item.type === 'ingredient') {
        if (item.deleted && item.inventoryId) {
          await deleteIngredient(item.inventoryId);
        } else if (item.remainingWeight !== null && item.remainingWeight > 0 && item.inventoryId) {
          await updateIngredient(item.inventoryId, { weight: item.remainingWeight });
        } else if (item.isNegative && !item.deleted && item.inventoryId) {
          await updateIngredient(item.inventoryId, { weight: null });
        }
      } else {
        // 调料
        if (item.deleted && item.inventoryId) {
          await deleteSeasoning(item.inventoryId);
        } else if (item.seasoningStatus && item.inventoryId) {
          await updateSeasoning(item.inventoryId, { status: item.seasoningStatus });
        }
      }
    }
    // 标记进度记录为已完成
    const sessionId = cookingState.session?.id;
    if (sessionId) {
      await cookingProgressService.markCompleted(sessionId);
    }
    setConfirmed(true);
    setTimeout(() => {
      router.replace('/(tabs)/cooking');
    }, 600);
  }, [items, deleteIngredient, updateIngredient, deleteSeasoning, updateSeasoning, cookingState.session?.id]);

  const ingredients = items.filter((i) => i.type === 'ingredient');
  const seasonings = items.filter((i) => i.type === 'seasoning');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handleBar}>
            <View style={styles.handle} />
            <Text style={styles.title}>完成做菜</Text>
            <Text style={styles.subtitle}>扣减用量 · 可删除用完的食材</Text>
          </View>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {/* 食材 */}
            {ingredients.length > 0 && (
              <Text style={styles.sectionTitle}>食材消耗</Text>
            )}
            {ingredients.map((item) => {
              const isRed = item.isNegative;
              const isDeleted = item.deleted;
              const noWeight = item.originalWeight === null;
              return (
                <View
                  key={'ing-' + item.name}
                  style={[
                    styles.itemRow,
                    isRed && styles.itemRowRed,
                    isDeleted && styles.itemRowDeleted,
                  ]}
                >
                  <View style={styles.itemInfo}>
                    <Text style={[styles.itemName, isDeleted && styles.itemTextDeleted]}>
                      {item.name}
                    </Text>
                    {noWeight ? (
                      <Text style={styles.itemWeight}>未记录重量</Text>
                    ) : isRed ? (
                      <Text style={styles.itemWeightRed}>
                        {item.originalWeight}g → -{item.consumedWeight}g → {item.remainingWeight}g
                      </Text>
                    ) : (
                      <Text style={styles.itemWeight}>
                        {item.originalWeight}g → -{item.consumedWeight}g → {item.remainingWeight}g
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={() => toggleDelete(item.name)}
                    hitSlop={12}
                    style={styles.deleteBtn}
                  >
                    <Ionicons
                      name={isDeleted ? 'arrow-undo-outline' : 'trash-outline'}
                      size={18}
                      color={isDeleted ? COLORS.textTertiary : isRed ? '#E53935' : COLORS.textTertiary}
                    />
                  </TouchableOpacity>
                </View>
              );
            })}
            {ingredients.length === 0 && (
              <Text style={styles.emptyText}>本次未使用库存食材</Text>
            )}

            {/* 调料 */}
            {seasonings.length > 0 && (
              <Text style={[styles.sectionTitle, { marginTop: SPACING.md }]}>调料使用</Text>
            )}
            {seasonings.map((item) => {
              const statusColor = SEASONING_STATUS_COLORS[item.seasoningStatus || 'sufficient'];
              const statusLabel = SEASONING_STATUS_LABELS[item.seasoningStatus || 'sufficient'];
              const isDeleted = item.deleted;
              return (
                <View
                  key={'sea-' + item.name}
                  style={[styles.itemRow, isDeleted && styles.itemRowDeleted]}
                >
                  <View style={styles.itemInfo}>
                    <Text style={[styles.itemName, isDeleted && styles.itemTextDeleted]}>
                      {item.name}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => toggleSeasoningStatus(item.name)}
                    style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor }]}
                  >
                    <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => toggleDelete(item.name)}
                    hitSlop={12}
                    style={styles.deleteBtn}
                  >
                    <Ionicons
                      name={isDeleted ? 'arrow-undo-outline' : 'trash-outline'}
                      size={18}
                      color={isDeleted ? COLORS.textTertiary : COLORS.textTertiary}
                    />
                  </TouchableOpacity>
                </View>
              );
            })}

            <View style={{ height: 80 }} />
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, confirmed && styles.confirmBtnDone]}
              onPress={handleConfirm}
              disabled={confirmed}
            >
              <Text style={styles.confirmBtnText}>
                {confirmed ? '已完成 ✓' : '确认完成'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.lg,
  },
  handleBar: { alignItems: 'center', paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  handle: { width: 40, height: 4, backgroundColor: COLORS.border, borderRadius: 2, marginBottom: SPACING.sm },
  title: { fontSize: TYPOGRAPHY.h3, fontWeight: '700', color: COLORS.textPrimary },
  subtitle: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginTop: 2 },
  list: { flexGrow: 0 },
  sectionTitle: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '700', color: COLORS.textSecondary, marginBottom: SPACING.sm },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.neutralLight,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.md,
    marginBottom: SPACING.xs,
  },
  itemRowRed: { backgroundColor: '#FFF0F0', borderLeftWidth: 3, borderLeftColor: '#E53935' },
  itemRowDeleted: { opacity: 0.4 },
  itemInfo: { flex: 1 },
  itemName: { fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary },
  itemTextDeleted: { textDecorationLine: 'line-through' },
  itemWeight: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  itemWeightRed: { fontSize: 12, color: '#E53935', marginTop: 2, fontWeight: '600' },
  deleteBtn: { padding: 6 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 6,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    gap: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.neutralLight,
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.textSecondary },
  confirmBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  confirmBtnDone: { backgroundColor: '#2D9F4E' },
  confirmBtnText: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '700', color: COLORS.textWhite },
  emptyText: { textAlign: 'center', color: COLORS.textTertiary, marginTop: 20, fontSize: TYPOGRAPHY.body },
});
