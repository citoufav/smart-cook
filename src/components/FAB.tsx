import React, { useRef } from 'react';
import { TouchableOpacity, Animated, Text, StyleSheet, ViewStyle } from 'react-native';
import { COLORS } from '../constants/colors';
import { SHADOWS } from '../constants/spacing';

interface FABProps {
  icon: string;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function FAB({ icon, onPress, accessibilityLabel, style }: FABProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.9, friction: 3, useNativeDriver: true }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }).start();
  };

  return (
    <Animated.View
      style={[
        styles.fab,
        SHADOWS.floating,
        { transform: [{ scale: scaleAnim }] },
        style,
      ]}
    >
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.8}
        accessibilityLabel={accessibilityLabel}
        style={styles.touchable}
      >
        <Text style={styles.icon}>{icon}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    zIndex: 100,
  },
  touchable: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 24,
    color: COLORS.textWhite,
  },
});
