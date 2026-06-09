import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TextInputProps,
} from 'react-native';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  suffix?: string;
  required?: boolean;
  disabled?: boolean;
}

export function Input({
  label,
  error,
  suffix,
  required = false,
  disabled = false,
  style,
  ...rest
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const borderColor = error
    ? COLORS.danger
    : isFocused
    ? COLORS.primary
    : COLORS.border;

  const backgroundColor = error
    ? COLORS.dangerLight
    : disabled
    ? COLORS.background
    : COLORS.surface;

  return (
    <View style={styles.container}>
      {label && (
        <Text style={styles.label}>
          {label}
          {required && <Text style={styles.required}> *</Text>}
        </Text>
      )}
      <View style={[styles.inputWrapper, { borderColor, backgroundColor }]}>
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={COLORS.textTertiary}
          editable={!disabled}
          onFocus={(e) => {
            setIsFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            rest.onBlur?.(e);
          }}
          {...rest}
        />
        {suffix && <Text style={styles.suffix}>{suffix}</Text>}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: TYPOGRAPHY.bodySmall,
    fontWeight: '500',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  required: {
    color: COLORS.danger,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: BORDER_RADIUS.md,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  input: {
    flex: 1,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    paddingVertical: SPACING.sm,
  },
  suffix: {
    fontSize: TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    marginLeft: SPACING.sm,
  },
  error: {
    fontSize: TYPOGRAPHY.caption,
    color: COLORS.danger,
    marginTop: SPACING.xs,
  },
});
