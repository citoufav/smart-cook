import React, { useRef, useMemo } from 'react';
import { Animated, PanResponder, Text, StyleSheet, ViewStyle, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/colors';
import { SHADOWS } from '../constants/spacing';

const FAB_SIZE = 56;
const EDGE_MARGIN = 8;
const TAB_BAR_HEIGHT = 56;
const TAP_THRESHOLD = 6;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface FABProps {
  icon: string;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
  /** 外部提供的持久化位置 ref，FAB 通过它记住拖拽位置（跨 mount/unmount） */
  positionRef?: React.MutableRefObject<{ x: number; y: number }>;
}

export function FAB({ icon, onPress, accessibilityLabel, style, positionRef }: FABProps) {
  const insets = useSafeAreaInsets();
  const positionAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const localPos = useRef({ x: 0, y: 0 });

  const snapX = useMemo(
    () => SCREEN_WIDTH - FAB_SIZE - EDGE_MARGIN - insets.right,
    [insets],
  );

  const constraints = useMemo(() => {
    const tabOffset = insets.bottom + TAB_BAR_HEIGHT;
    return {
      minX: EDGE_MARGIN,
      maxX: snapX,
      minY: insets.top + EDGE_MARGIN,
      maxY: SCREEN_HEIGHT - FAB_SIZE - tabOffset - 16,
    };
  }, [insets, snapX]);

  const defaultPos = { x: snapX, y: constraints.maxY };

  // 初始化：优先用外部持久位置，否则用默认位置
  if (localPos.current.x === 0 && localPos.current.y === 0) {
    const saved = positionRef?.current;
    if (saved && saved.x !== 0 && saved.y !== 0) {
      localPos.current = { ...saved };
    } else {
      localPos.current = { ...defaultPos };
    }
    positionAnim.setValue(localPos.current);
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        Animated.spring(scaleAnim, { toValue: 1.1, useNativeDriver: true }).start();
      },
      onPanResponderMove: (_, gesture) => {
        const newX = Math.min(constraints.maxX, Math.max(constraints.minX, localPos.current.x + gesture.dx));
        const newY = Math.min(constraints.maxY, Math.max(constraints.minY, localPos.current.y + gesture.dy));
        positionAnim.setValue({ x: newX, y: newY });
      },
      onPanResponderRelease: (_, gesture) => {
        Animated.spring(scaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }).start();
        const newX = Math.min(constraints.maxX, Math.max(constraints.minX, localPos.current.x + gesture.dx));
        const newY = Math.min(constraints.maxY, Math.max(constraints.minY, localPos.current.y + gesture.dy));
        const snapTargetX = newX > SCREEN_WIDTH / 2 ? constraints.maxX : constraints.minX;
        const final = { x: snapTargetX, y: newY };
        localPos.current = final;
        // 同步到外部持久 ref
        if (positionRef) {
          positionRef.current = final;
        }
        Animated.spring(positionAnim, {
          toValue: final,
          friction: 7,
          tension: 60,
          useNativeDriver: true,
        }).start();

        if (Math.abs(gesture.dx) < TAP_THRESHOLD && Math.abs(gesture.dy) < TAP_THRESHOLD) {
          onPress();
        }
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[
        styles.fab,
        SHADOWS.floating,
        {
          transform: [
            { translateX: positionAnim.x },
            { translateY: positionAnim.y },
            { scale: scaleAnim },
          ],
        },
        style,
      ]}
      {...panResponder.panHandlers}
    >
      <Text style={styles.icon}>{icon}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  icon: {
    fontSize: 24,
    color: COLORS.textWhite,
  },
});
