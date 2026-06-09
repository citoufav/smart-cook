import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../constants/spacing';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 64, 320);

export interface CustomAlertButton {
  text: string;
  variant?: 'primary' | 'ghost';
  onPress: () => void;
}

interface CustomAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons: CustomAlertButton[];
  onDismiss?: () => void;
}

export function CustomAlert({ visible, title, message, buttons, onDismiss }: CustomAlertProps) {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.85)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(cardScale, { toValue: 1, friction: 8, tension: 80, useNativeDriver: true }),
        Animated.timing(cardOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(cardScale, { toValue: 0.85, duration: 150, useNativeDriver: true }),
        Animated.timing(cardOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!visible && (backdropOpacity as any)._value === 0) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onDismiss}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.card,
          {
            opacity: cardOpacity,
            transform: [{ scale: cardScale }],
          },
        ]}
      >
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={styles.buttonRow}>
          {buttons.map((btn, idx) => (
            <TouchableOpacity
              key={idx}
              style={[
                styles.button,
                btn.variant === 'primary' && styles.buttonPrimary,
                idx > 0 && styles.buttonGap,
              ]}
              onPress={btn.onPress}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.buttonText,
                  btn.variant === 'primary' && styles.buttonTextPrimary,
                ]}
              >
                {btn.text}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
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
    zIndex: 3000,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  backdropTouch: {
    flex: 1,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.lg,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  message: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  button: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    backgroundColor: COLORS.neutralLight,
  },
  buttonPrimary: {
    backgroundColor: COLORS.primary,
  },
  buttonGap: {
    marginLeft: 0,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  buttonTextPrimary: {
    color: COLORS.textWhite,
  },
});
