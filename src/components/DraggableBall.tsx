import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SHADOWS } from '../constants/spacing';

const BALL_SIZE = 56;
const EDGE_MARGIN = 8;
const TAB_BAR_HEIGHT = 56;
const BOTTOM_BAR_OFFSET = 76;
const NO_BAR_OFFSET = 16;
const TAP_THRESHOLD = 6;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface BallRect {
  x: number;
  y: number;
  size: number;
}

interface DraggableBallProps {
  visible: boolean;
  color: string;
  /** 停靠侧：left = 默认贴左边缘 / right = 默认贴右边缘 */
  snapSide: 'left' | 'right';
  /** prep/cooking 阶段为底部操作栏预留更多空间 */
  isInteractive: boolean;
  /** 另一颗球的屏幕坐标，用于碰撞分离 */
  otherBallRect?: React.MutableRefObject<BallRect | null>;
  /** 位置更新回调（供另一颗球做碰撞检测） */
  onPositionUpdate?: (x: number, y: number) => void;
  onPress: () => void;
  children?: React.ReactNode;
}

/**
 * 可拖拽悬浮球的共享实现（营养球 / 聊天球共用）：
 * 自由拖拽 → 松手吸附最近边缘 → 双球碰撞分离；轻点（位移 < 6px）视为点击。
 */
export function DraggableBall({
  visible,
  color,
  snapSide,
  isInteractive,
  otherBallRect,
  onPositionUpdate,
  onPress,
  children,
}: DraggableBallProps) {
  const insets = useSafeAreaInsets();

  const positionAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const lastPos = useRef({ x: 0, y: 0 });
  // 隐藏动画结束后卸载，释放触摸区域（不读取 Animated 私有 _value）
  const [mounted, setMounted] = useState(visible);

  // 保持最新 onPress，避免 PanResponder 闭包过期
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  const bottomOffset = useMemo(
    () => (isInteractive ? BOTTOM_BAR_OFFSET : NO_BAR_OFFSET),
    [isInteractive],
  );

  const constraints = useMemo(() => {
    const tabBarSafeArea = insets.bottom + TAB_BAR_HEIGHT;
    return {
      minX: EDGE_MARGIN,
      maxX: SCREEN_WIDTH - BALL_SIZE - EDGE_MARGIN,
      minY: insets.top + EDGE_MARGIN + 8,
      maxY: SCREEN_HEIGHT - BALL_SIZE - tabBarSafeArea - bottomOffset,
    };
  }, [insets, bottomOffset]);

  // PanResponder 闭包只捕获首帧值：经 ref 读取最新约束，避免 bottomOffset 变化后拖拽边界失效
  const constraintsRef = useRef(constraints);
  constraintsRef.current = constraints;

  const defaultX = snapSide === 'left' ? constraints.minX : constraints.maxX;
  const defaultY = constraints.maxY;

  // Collision: push away from the other ball
  const checkCollision = (myX: number, myY: number): { x: number; y: number } => {
    const c = constraintsRef.current;
    const other = otherBallRect?.current;
    if (!other) return { x: myX, y: myY };

    const myCenterX = myX + BALL_SIZE / 2;
    const myCenterY = myY + BALL_SIZE / 2;
    const otherCenterX = other.x + other.size / 2;
    const otherCenterY = other.y + other.size / 2;

    const dx = myCenterX - otherCenterX;
    const dy = myCenterY - otherCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = BALL_SIZE / 2 + other.size / 2 + 12; // 12px margin

    if (dist < minDist && dist > 0) {
      const pushX = (dx / dist) * (minDist - dist);
      const pushY = (dy / dist) * (minDist - dist);
      return {
        x: Math.min(c.maxX, Math.max(c.minX, myX + pushX)),
        y: Math.min(c.maxY, Math.max(c.minY, myY + pushY)),
      };
    }
    return { x: myX, y: myY };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        Animated.spring(scaleAnim, { toValue: 1.1, useNativeDriver: true }).start();
      },
      onPanResponderMove: (_, gesture) => {
        const c = constraintsRef.current;
        const newX = Math.min(c.maxX, Math.max(c.minX, lastPos.current.x + gesture.dx));
        const newY = Math.min(c.maxY, Math.max(c.minY, lastPos.current.y + gesture.dy));
        positionAnim.setValue({ x: newX, y: newY });
      },
      onPanResponderRelease: (_, gesture) => {
        Animated.spring(scaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }).start();
        const c = constraintsRef.current;
        const newX = Math.min(c.maxX, Math.max(c.minX, lastPos.current.x + gesture.dx));
        const newY = Math.min(c.maxY, Math.max(c.minY, lastPos.current.y + gesture.dy));

        // Snap to the nearest edge
        const snapX = newX > SCREEN_WIDTH / 2 ? c.maxX : c.minX;
        const adjusted = checkCollision(snapX, newY);
        lastPos.current = { x: adjusted.x, y: adjusted.y };
        onPositionUpdate?.(adjusted.x, adjusted.y);
        Animated.spring(positionAnim, {
          toValue: { x: adjusted.x, y: adjusted.y },
          friction: 7,
          tension: 60,
          useNativeDriver: true,
        }).start();

        // Tiny movement = tap
        if (Math.abs(gesture.dx) < TAP_THRESHOLD && Math.abs(gesture.dy) < TAP_THRESHOLD) {
          onPressRef.current();
        }
      },
    }),
  ).current;

  // Reset position when stage/mode changes
  useEffect(() => {
    lastPos.current = { x: defaultX, y: defaultY };
    positionAnim.setValue({ x: defaultX, y: defaultY });
    onPositionUpdate?.(defaultX, defaultY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomOffset]);

  // Show/hide
  useEffect(() => {
    if (visible) {
      setMounted(true);
      lastPos.current = { x: defaultX, y: defaultY };
      positionAnim.setValue({ x: defaultX, y: defaultY });
      onPositionUpdate?.(defaultX, defaultY);
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, friction: 6, tension: 100, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(scaleAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => {
        setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;

  return (
    <Animated.View
      style={[
        styles.ball,
        SHADOWS.floating,
        { backgroundColor: color },
        {
          transform: [
            { translateX: positionAnim.x },
            { translateY: positionAnim.y },
            { scale: scaleAnim },
          ],
          opacity: opacityAnim,
        },
      ]}
      {...panResponder.panHandlers}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ball: {
    position: 'absolute',
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
