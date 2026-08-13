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
}

export default function HeaderBar({ title, onOpenDrawer }: HeaderBarProps) {
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
        <Text style={styles.title}>{title}</Text>
        {/* Right spacer to keep the title centered */}
        <View style={styles.headerRight} />
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
  title: {
    fontSize: TYPOGRAPHY.h1,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  headerRight: {
    width: 30, // Same width as the left menu icon to keep the title centered
  },
});
