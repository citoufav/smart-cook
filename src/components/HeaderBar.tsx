import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING } from '../constants/spacing';

interface HeaderBarProps {
  title: string;
  onOpenDrawer: () => void;
  /** 右上角插槽。标题用绝对定位居中，所以插槽多宽都不会把标题挤歪 */
  right?: React.ReactNode;
}

export default function HeaderBar({ title, onOpenDrawer, right }: HeaderBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <>
      {/* Safe-area padding */}
      <View style={[styles.safeTop, { height: insets.top }]} />
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onOpenDrawer} hitSlop={12}>
          <Ionicons name="menu-outline" size={30} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={styles.titleWrap} pointerEvents="none">
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.headerRight}>{right}</View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safeTop: { backgroundColor: COLORS.surface },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
  },
  // 绝对铺满 + 居中：右上角放了东西也还是正中间，不靠左右等宽凑
  titleWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  title: {
    fontSize: TYPOGRAPHY.h1,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  headerRight: { marginLeft: 'auto' },
});
