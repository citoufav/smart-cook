import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  style?: ViewStyle;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled = false,
  onPress,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const getVariantStyle = (): ViewStyle => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: isDisabled ? COLORS.primaryLight : COLORS.primary,
        };
      case 'secondary':
        return {
          backgroundColor: COLORS.surface,
          borderWidth: 1.5,
          borderColor: COLORS.primary,
        };
      case 'ghost':
        return { backgroundColor: 'transparent' };
      case 'danger':
        return {
          backgroundColor: COLORS.dangerLight,
          borderWidth: 1.5,
          borderColor: COLORS.danger,
        };
    }
  };

  const getTextStyle = (): TextStyle => {
    switch (variant) {
      case 'primary':
        return { color: COLORS.textWhite };
      case 'secondary':
      case 'ghost':
        return { color: COLORS.primary };
      case 'danger':
        return { color: COLORS.danger };
    }
  };

  const getSizeStyle = (): ViewStyle => {
    switch (size) {
      case 'sm':
        return { height: 44, paddingHorizontal: SPACING.lg };
      case 'md':
        return { height: 44, paddingHorizontal: SPACING.lg };
      case 'lg':
        return { height: 52, paddingHorizontal: SPACING.xxl };
    }
  };

  const getTextSizeStyle = (): TextStyle => {
    switch (size) {
      case 'sm':
        return { fontSize: 14 };
      case 'md':
        return { fontSize: TYPOGRAPHY.button };
      case 'lg':
        return { fontSize: TYPOGRAPHY.h4 };
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.base,
        getVariantStyle(),
        getSizeStyle(),
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      activeOpacity={0.7}
      disabled={isDisabled}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? COLORS.textWhite : COLORS.primary} size="small" />
      ) : (
        <Text style={[styles.text, getTextStyle(), getTextSizeStyle(), isDisabled && styles.disabledText]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS.md,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
  disabledText: {
    opacity: 0.7,
  },
  text: {
    fontWeight: '600',
  },
});
