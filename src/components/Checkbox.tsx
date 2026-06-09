import React, { useRef, useEffect } from 'react';
import {
  TouchableOpacity,
  View,
  Text,
  Animated,
  StyleSheet,
} from 'react-native';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';

interface CheckboxProps {
  checked: boolean;
  onToggle: (checked: boolean) => void;
  label?: string;
  labelContent?: React.ReactNode;
  disabled?: boolean;
}

export function Checkbox({ checked, onToggle, label, labelContent, disabled = false }: CheckboxProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const animate = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.8, duration: 80, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();
  };

  const handleToggle = () => {
    if (disabled) return;
    animate();
    onToggle(!checked);
  };

  return (
    <TouchableOpacity
      style={[styles.row, disabled && styles.disabled]}
      onPress={handleToggle}
      activeOpacity={0.7}
      disabled={disabled}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Animated.View
        style={[
          styles.box,
          { transform: [{ scale: scaleAnim }] },
          checked && styles.boxChecked,
        ]}
      >
        {checked && <Text style={styles.checkmark}>✓</Text>}
      </Animated.View>
      {labelContent ? (
        <View style={styles.labelContent}>{labelContent}</View>
      ) : label ? (
        <Text style={[styles.label, checked && styles.labelChecked]}>{label}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
  },
  box: {
    width: 28,
    height: 28,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  boxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkmark: {
    color: COLORS.textWhite,
    fontSize: 16,
    fontWeight: '700',
  },
  label: {
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    marginLeft: SPACING.md,
    flex: 1,
  },
  labelChecked: {
    color: COLORS.textTertiary,
    textDecorationLine: 'line-through',
  },
  labelContent: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  disabled: {
    opacity: 0.5,
  },
});
