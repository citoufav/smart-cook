import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Animated,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { useNutrition } from '../contexts/NutritionContext';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { getDailyPercent, getPerPersonNutrition } from '../utils/nutrition';
import { DAILY_RECOMMENDED } from '../constants/cooking';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_MAX_HEIGHT = 450;

export function NutritionBottomSheet() {
  const { state, dispatch } = useNutrition();
  const translateY = useRef(new Animated.Value(SHEET_MAX_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [activeTabIndex, setActiveTabIndex] = useState(-1); // -1 = 总计

  const close = () => dispatch({ type: 'CLOSE_SHEET' });

  useEffect(() => {
    if (state.isDetailOpen) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, friction: 8, tension: 65, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: SHEET_MAX_HEIGHT, duration: 250, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    }
  }, [state.isDetailOpen]);

  if (!state.isDetailOpen && translateY._value === SHEET_MAX_HEIGHT) return null;

  const activeData = activeTabIndex === -1
    ? getPerPersonNutrition(state.totalNutrition, state.personCount)
    : state.nutritionByDish[state.dishNames[activeTabIndex]];

  console.log('[NUTRITION:SHEET] 渲染面板 | activeTab:', activeTabIndex, '| activeData:', JSON.stringify(activeData), '| personCount:', state.personCount);

  const nutritionRows = [
    { label: '热量', value: activeData?.calories || 0, unit: '大卡', dailyValue: DAILY_RECOMMENDED.calories, color: '#FF6B35' },
    { label: '蛋白质', value: activeData?.protein || 0, unit: 'g', dailyValue: DAILY_RECOMMENDED.protein, color: '#2196F3' },
    { label: '脂肪', value: activeData?.fat || 0, unit: 'g', dailyValue: DAILY_RECOMMENDED.fat, color: '#FFC107' },
    { label: '碳水', value: activeData?.carbs || 0, unit: 'g', dailyValue: DAILY_RECOMMENDED.carbs, color: '#4CAF50' },
  ];

  return (
    <View style={styles.container}>
      {/* 遮罩层 — 使用 Pressable 确保可点击 */}
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents="auto"
      >
        <Pressable
          onPress={close}
          style={styles.backdropPressable}
        />
      </Animated.View>

      {/* 面板 */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>营养成分</Text>
          <TouchableOpacity
            onPress={close}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Tab */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
          <TouchableOpacity
            style={[styles.tab, activeTabIndex === -1 && styles.tabActive]}
            onPress={() => setActiveTabIndex(-1)}
          >
            <Text style={[styles.tabText, activeTabIndex === -1 && styles.tabTextActive]}>总计</Text>
          </TouchableOpacity>
          {state.dishNames.map((name, idx) => (
            <TouchableOpacity
              key={name}
              style={[styles.tab, activeTabIndex === idx && styles.tabActive]}
              onPress={() => setActiveTabIndex(idx)}
            >
              <Text style={[styles.tabText, activeTabIndex === idx && styles.tabTextActive]}>{name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* 营养行 */}
        {nutritionRows.map((row) => {
          const percent = getDailyPercent(row.value, row.dailyValue);
          return (
            <View key={row.label} style={styles.nutritionRow}>
              <View style={styles.nutritionHeader}>
                <Text style={styles.nutritionLabel}>{row.label}</Text>
                <Text style={styles.nutritionValue}>
                  {Math.round(row.value)} {row.unit}
                </Text>
              </View>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min(percent, 100)}%`,
                      backgroundColor: percent > 100 ? '#E74C3C' : row.color,
                    },
                  ]}
                />
              </View>
              <Text style={styles.percentText}>{percent}% 日推荐</Text>
            </View>
          );
        })}

        <Text style={styles.footer}>
          {state.accuracy === 'estimated' ? '基于 AI 估算' : '基于实际称量估算'}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
    pointerEvents: 'box-none',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 1,
  },
  backdropPressable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SHEET_MAX_HEIGHT,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: SPACING.lg,
    zIndex: 2,
  },
  handle: { width: 40, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: 'center', marginBottom: SPACING.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  title: { fontSize: TYPOGRAPHY.h3, fontWeight: '700', color: COLORS.textPrimary },
  closeBtn: { fontSize: 22, color: COLORS.textSecondary, padding: 4 },
  tabScroll: { marginBottom: SPACING.md, maxHeight: 40 },
  tab: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, marginRight: SPACING.sm, borderRadius: BORDER_RADIUS.xl, backgroundColor: COLORS.neutralLight },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary },
  tabTextActive: { color: COLORS.textWhite },
  nutritionRow: { marginBottom: SPACING.md },
  nutritionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs },
  nutritionLabel: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textBody },
  nutritionValue: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.textPrimary },
  progressBarBg: { height: 6, backgroundColor: COLORS.neutralLight, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
  percentText: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginTop: 2, textAlign: 'right' },
  footer: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, textAlign: 'center', marginTop: SPACING.md },
});
