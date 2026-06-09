import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../constants/spacing';

interface CardProps {
  title?: string;
  children: React.ReactNode;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  pressable?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

export function Card({
  title,
  children,
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
  pressable = false,
  onPress,
  style,
}: CardProps) {
  const content = (
    <View style={[styles.card, SHADOWS.sm, style]}>
      {(title || collapsible) && (
        <TouchableOpacity
          style={styles.header}
          onPress={collapsible ? onToggleCollapse : undefined}
          disabled={!collapsible}
          activeOpacity={0.6}
        >
          {title && <Text style={styles.title}>{title}</Text>}
          {collapsible && (
            <Text style={styles.arrow}>{collapsed ? '▼' : '▲'}</Text>
          )}
        </TouchableOpacity>
      )}
      {!collapsed && <View style={styles.body}>{children}</View>}
    </View>
  );

  if (pressable && onPress) {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  title: {
    fontSize: TYPOGRAPHY.h4,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  arrow: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  body: {},
});
