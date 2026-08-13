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
import { logger } from '../utils/logger';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_MAX_HEIGHT = 450;

const log = logger('COMP:SHEET');

export function NutritionBottomSheet() {
  const { state, dispatch } = useNutrition();
  const translateY = useRef(new Animated.Value(SHEET_MAX_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [activeTabIndex, setActiveTabIndex] = useState(-1);
  const [mounted, setMounted] = useState(false);

  const close = () => dispatch({ type: 'CLOSE_SHEET' });

  useEffect(() => {
    if (state.isDetailOpen) {
      setMounted(true);
      setActiveTabIndex(-1); // 每次打开默认选中总计
      log.info('OPEN', { isDetailOpen: true });
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, friction: 8, tension: 65, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: SHEET_MAX_HEIGHT, duration: 250, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start(() => {
        // 动画完成后卸载组件，释放触摸事件
        setMounted(false);
      });
    }
  }, [state.isDetailOpen]);

  if (!mounted && !state.isDetailOpen) return null;

  const activeData = activeTabIndex === -1
    ? getPerPersonNutrition(state.totalNutrition, state.personCount)
    : state.nutritionByDish[state.dishNames[activeTabIndex]];

  // 总计tab同时显示总营养（用于对比各菜品）
  const totalData = activeTabIndex === -1 ? state.totalNutrition : null;

  log.info('SHEET_RENDER', { activeTab: activeTabIndex, personCount: state.personCount });

  const makeRows = (data: typeof activeData, labelPrefix?: string) => [
    { label: `${labelPrefix || ''}热量`, value: data?.calories || 0, unit: '大卡', dailyValue: DAILY_RECOMMENDED.calories, color: '#FF6B35' },
    { label: `${labelPrefix || ''}蛋白质`, value: data?.protein || 0, unit: 'g', dailyValue: DAILY_RECOMMENDED.protein, color: '#2196F3' },
    { label: `${labelPrefix || ''}脂肪`, value: data?.fat || 0, unit: 'g', dailyValue: DAILY_RECOMMENDED.fat, color: '#FFC107' },
    { label: `${labelPrefix || ''}碳水`, value: data?.carbs || 0, unit: 'g', dailyValue: DAILY_RECOMMENDED.carbs, color: '#4CAF50' },
  ];

  const nutritionRows = makeRows(activeData);
  const totalRows = totalData ? makeRows(totalData) : null;

  return (
    <View style={styles.container}>
      {/* 遮罩层 — 使用 Pressable 确保可点击 */}
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents={state.isDetailOpen ? 'auto' : 'none'}
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
            onPress={() => {
              log.debug('TAB_CHANGE', { tabIndex: -1 });
              setActiveTabIndex(-1);
            }}
          >
            <Text style={[styles.tabText, activeTabIndex === -1 && styles.tabTextActive]}>总计</Text>
          </TouchableOpacity>
          {state.dishNames.map((name, idx) => (
            <TouchableOpacity
              key={name}
              style={[styles.tab, activeTabIndex === idx && styles.tabActive]}
              onPress={() => {
                log.debug('TAB_CHANGE', { tabIndex: idx });
                setActiveTabIndex(idx);
              }}
            >
              <Text style={[styles.tabText, activeTabIndex === idx && styles.tabTextActive]}>{name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView style={styles.bodyScroll} showsVerticalScrollIndicator={false}>
        {/* 总计tab：总营养 + 分隔线 + 人均 */}
        {totalRows && (
          <>
            <Text style={styles.sectionTitle}>
              总营养 ({state.personCount}人份)
            </Text>
            {totalRows.map((row) => {
              const percent = getDailyPercent(row.value, row.dailyValue * state.personCount);
              return (
                <View key={'total-' + row.label} style={styles.nutritionRow}>
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
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>
              人均 (÷{state.personCount})
            </Text>
          </>
        )}

        {/* 菜品tab：菜品总营养（仅显示在该菜标签下） */}
        {activeTabIndex >= 0 && (
          <Text style={styles.sectionTitle}>
            菜品总营养
          </Text>
        )}

        {/* 当前tab的营养行（总计=人均，菜品=菜品总营养） */}
        {nutritionRows.map((row) => {
          const displayValue = activeTabIndex === -1 ? row.value : row.value / state.personCount;
          const percent = getDailyPercent(displayValue, row.dailyValue);
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

        {/* 菜品tab：在总营养后追加显示人均 */}
        {activeTabIndex >= 0 && (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>
              人均 (÷{state.personCount || 1})
            </Text>
            {nutritionRows.map((row) => {
              const perValue = state.personCount > 0 ? row.value / state.personCount : row.value;
              const percent = getDailyPercent(perValue, row.dailyValue);
              return (
                <View key={'per-' + row.label} style={styles.nutritionRow}>
                  <View style={styles.nutritionHeader}>
                    <Text style={styles.nutritionLabel}>{row.label}</Text>
                    <Text style={styles.nutritionValue}>
                      {Math.round(perValue)} {row.unit}
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
          </>
        )}

        <Text style={styles.footer}>
                  {state.accuracy === 'estimated' ? '基于 AI 估算' : '基于实际称量估算'}
                </Text>
        </ScrollView>
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
  bodyScroll: { flex: 1 },
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
  sectionTitle: { fontSize: TYPOGRAPHY.caption, fontWeight: '600', color: COLORS.textSecondary, marginBottom: SPACING.sm },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: SPACING.sm },
  footer: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, textAlign: 'center', marginTop: SPACING.md },
});
