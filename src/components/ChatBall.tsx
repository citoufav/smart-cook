import React, { useRef, useEffect, useMemo } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useCooking } from '../contexts/CookingContext';
import { getStageIndex } from '../types';
import { COLORS } from '../constants/colors';
import { SHADOWS } from '../constants/spacing';

const BALL_SIZE = 56;
const EDGE_MARGIN = 8;
const TAB_BAR_HEIGHT = 56;
const BOTTOM_BAR_OFFSET = 76;
const NO_BAR_OFFSET = 16;
const TAP_THRESHOLD = 6;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ChatBallProps {
  visible: boolean;
  /** 另一个球的当前屏幕坐标，用于碰撞检测 */
  otherBallRect: React.MutableRefObject<{ x: number; y: number; size: number } | null>;
  onPress: () => void;
  /** 位置更新回调，用于碰撞检测 */
  onPositionUpdate?: (x: number, y: number) => void;
}

export function ChatBall({ visible, otherBallRect, onPress, onPositionUpdate }: ChatBallProps) {
  const { state: cookingState } = useCooking();
  const insets = useSafeAreaInsets();

  const positionAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const lastPos = useRef({ x: 0, y: 0 });

  // 用 ref 保持最新的 onPress，避免 PanResponder 闭包过期
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  const session = cookingState.session;
  const currentStage = session?.status || '';

  const isInteractive = useMemo(() => {
    if (!session) return false;
    const stageIdx = getStageIndex(session.status);
    if (stageIdx < 0) return false;
    return stageIdx > session.completedStageIndex;
  }, [session?.status, session?.completedStageIndex]);

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

  // 默认位置：左下角
  const defaultX = constraints.minX;
  const defaultY = constraints.maxY;

  // 碰撞检测：两个球圆心距离小于直径 + 间距则碰撞
  const checkCollision = (myX: number, myY: number): { x: number; y: number } => {
    const other = otherBallRect.current;
    if (!other) return { x: myX, y: myY };

    const myCenterX = myX + BALL_SIZE / 2;
    const myCenterY = myY + BALL_SIZE / 2;
    const otherCenterX = other.x + other.size / 2;
    const otherCenterY = other.y + other.size / 2;

    const dx = myCenterX - otherCenterX;
    const dy = myCenterY - otherCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = BALL_SIZE / 2 + other.size / 2 + 12; // 12px 间距

    if (dist < minDist && dist > 0) {
      // 推开
      const pushX = (dx / dist) * (minDist - dist);
      const pushY = (dy / dist) * (minDist - dist);
      return {
        x: Math.min(constraints.maxX, Math.max(constraints.minX, myX + pushX)),
        y: Math.min(constraints.maxY, Math.max(constraints.minY, myY + pushY)),
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
        const newX = Math.min(constraints.maxX, Math.max(constraints.minX, lastPos.current.x + gesture.dx));
        const newY = Math.min(constraints.maxY, Math.max(constraints.minY, lastPos.current.y + gesture.dy));
        positionAnim.setValue({ x: newX, y: newY });
      },
      onPanResponderRelease: (_, gesture) => {
        Animated.spring(scaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }).start();
        const newX = Math.min(constraints.maxX, Math.max(constraints.minX, lastPos.current.x + gesture.dx));
        const newY = Math.min(constraints.maxY, Math.max(constraints.minY, lastPos.current.y + gesture.dy));

        // 吸附最近边缘
        const snapX = newX > SCREEN_WIDTH / 2 ? constraints.maxX : constraints.minX;
        const adjusted = checkCollision(snapX, newY);

        lastPos.current = { x: adjusted.x, y: adjusted.y };
        onPositionUpdate?.(adjusted.x, adjusted.y);
        Animated.spring(positionAnim, {
          toValue: { x: adjusted.x, y: adjusted.y },
          friction: 7,
          tension: 60,
          useNativeDriver: true,
        }).start();

        // 极小移动 = 点击
        if (Math.abs(gesture.dx) < TAP_THRESHOLD && Math.abs(gesture.dy) < TAP_THRESHOLD) {
          onPressRef.current();
        }
      },
    }),
  ).current;

  // 阶段/模式变化时重置位置
  useEffect(() => {
    lastPos.current = { x: defaultX, y: defaultY };
    positionAnim.setValue({ x: defaultX, y: defaultY });
    onPositionUpdate?.(defaultX, defaultY);
  }, [bottomOffset]);

  // 显示/隐藏
  useEffect(() => {
    if (visible) {
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
      ]).start();
    }
  }, [visible]);

  if (!visible && (scaleAnim as any)._value === 0) return null;

  return (
    <Animated.View
      style={[
        styles.ball,
        SHADOWS.floating,
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
      <Ionicons name="chatbubble-ellipses" size={24} color={COLORS.textWhite} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ball: {
    position: 'absolute',
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
