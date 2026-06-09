import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { SeasoningStatus } from '../types';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  variant: BadgeVariant;
  label: string;
  size?: BadgeSize;
  style?: ViewStyle;
}

const VARIANT_COLORS: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: COLORS.successLight, text: COLORS.success },
  warning: { bg: COLORS.warningLight, text: COLORS.warningText },
  danger: { bg: COLORS.dangerLight, text: COLORS.danger },
  info: { bg: COLORS.infoLight, text: COLORS.info },
  neutral: { bg: COLORS.neutralLight, text: COLORS.neutral },
};

export function seasoningStatusToBadge(status: SeasoningStatus): BadgeVariant {
  switch (status) {
    case 'sufficient': return 'success';
    case 'low': return 'warning';
    case 'out': return 'danger';
  }
}

export function Badge({ variant, label, size = 'sm', style }: BadgeProps) {
  const colors = VARIANT_COLORS[variant];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.bg },
        size === 'md' && styles.badgeMd,
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: colors.text },
          size === 'md' && styles.textMd,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.lg,
    alignSelf: 'flex-start',
  },
  badgeMd: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  text: {
    fontSize: TYPOGRAPHY.badge,
    fontWeight: '500',
  },
  textMd: {
    fontSize: TYPOGRAPHY.caption,
  },
});
