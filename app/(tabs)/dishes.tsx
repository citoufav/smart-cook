import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettingsDrawer } from '../../src/contexts/SettingsDrawerContext';
import { useNutrition } from '../../src/contexts/NutritionContext';
import HeaderBar from '../../src/components/HeaderBar';
import { InventoryProfileChip, InventoryProfileSheet } from '../../src/components/InventoryProfileSheet';
import { EmptyState } from '../../src/components/EmptyState';
import { dishLibraryService } from '../../src/services/dishLibraryService';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import type { SavedDish } from '../../src/types';

function formatLastCooked(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 菜品库：做过的菜按「道」存下来，想吃哪道点哪道 */
export default function DishesScreen() {
  const { openSettings } = useSettingsDrawer();
  const { hideBall } = useNutrition();
  const insets = useSafeAreaInsets();

  const [dishes, setDishes] = useState<SavedDish[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);

  // 这个页面不显示营养球，和其他 tab 保持一致
  useFocusEffect(
    useCallback(() => {
      hideBall();
    }, [hideBall]),
  );

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      dishLibraryService
        .list()
        .then((items) => {
          if (alive) setDishes(items);
        })
        .catch(() => {})
        .finally(() => {
          if (alive) setLoading(false);
        });
      return () => {
        alive = false;
      };
    }, []),
  );

  /**
   * 两列固定各占一半（减去内边距和列间距）。
   *
   * 之前用 flex:1 让卡片自己撑开：最后一行只有一张时，它会横跨整行，
   * 宽度和其它卡片完全不一样，看着像出了 bug。宁可写死宽度。
   */
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = (screenWidth - SPACING.md * 2 - SPACING.md) / 2;

  const renderItem = useCallback(
    ({ item }: { item: SavedDish }) => (
      <TouchableOpacity
        style={[styles.card, { width: cardWidth }]}
        activeOpacity={0.75}
        onPress={() => router.push({ pathname: '/dish/[id]', params: { id: item.id } })}
      >
        <Text style={styles.cardName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.cardCalories}>{item.estimatedNutrition.calories} 大卡</Text>
        <Text style={styles.cardMeta}>
          做过 {item.timesCooked} 次
          {item.lastCookedAt ? ` · ${formatLastCooked(item.lastCookedAt)}` : ''}
        </Text>
      </TouchableOpacity>
    ),
    [cardWidth],
  );

  return (
    <View style={styles.container}>
      <HeaderBar
        title="随煮"
        onOpenDrawer={openSettings}
        right={<InventoryProfileChip onPress={() => setProfileSheetOpen(true)} />}
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : dishes.length === 0 ? (
        <EmptyState
          icon="🍳"
          title="还没有做过的菜"
          description="做完一顿饭，菜单里的每道菜会自动存到这里，下次想吃直接点开看。"
          action={{ label: '去做菜', onPress: () => router.push('/(tabs)/cooking') }}
        />
      ) : (
        <FlatList
          data={dishes}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + SPACING.lg }]}
          showsVerticalScrollIndicator={false}
        />
      )}

      <InventoryProfileSheet visible={profileSheetOpen} onClose={() => setProfileSheetOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: SPACING.md, gap: SPACING.md },
  row: { gap: SPACING.md },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    minHeight: 108,
    justifyContent: 'space-between',
    ...SHADOWS.sm,
  },
  cardName: { fontSize: TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textPrimary },
  cardCalories: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.primary, marginTop: SPACING.xs },
  cardMeta: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginTop: SPACING.xs },
});
