import React, { useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Animated,
  PanResponder,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNutrition } from '../contexts/NutritionContext';
import { useCooking } from '../contexts/CookingContext';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SHADOWS } from '../constants/spacing';
import { getPerPersonNutrition } from '../utils/nutrition';
import { logger } from '../utils/logger';

const BALL_SIZE = 56;
const EDGE_MARGIN = 8;
const TAB_BAR_HEIGHT = 56;
const BOTTOM_BAR_OFFSET = 76;
const NO_BAR_OFFSET = 16;
const TAP_THRESHOLD = 6;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const log = logger('COMP:BALL');

interface FloatingBallProps {
  /** 另一个球的当前屏幕坐标，用于碰撞检测 */
  otherBallRect?: React.MutableRefObject<{ x: number; y: number; size: number } | null>;
  /** 位置更新回调，用于碰撞检测 */
  onPositionUpdate?: (x: number, y: number) => void;
}

export function FloatingBall({ otherBallRect, onPositionUpdate }: FloatingBallProps) {
  const { state, dispatch } = useNutrition();
  const { state: cookingState } = useCooking();
  const insets = useSafeAreaInsets();

  const positionAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const lastPos = useRef({ x: 0, y: 0 });

  // 用 ref 保持最新的 state，避免 PanResponder 闭包过期
  const stateRef = useRef(state);
  stateRef.current = state;

  // 进行中的进度阶段（prep/cooking）才需要为底部操作栏留出空间
  const isInteractive = useMemo(() => {
    return cookingState.session?.status === 'prep' || cookingState.session?.status === 'cooking';
  }, [cookingState.session?.status]);

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

  // 默认位置：右下角
  const defaultX = constraints.maxX;
  const defaultY = constraints.maxY;

  // 碰撞检测
  const checkCollision = (myX: number, myY: number): { x: number; y: number } => {
    const other = otherBallRect?.current;
    if (!other) return { x: myX, y: myY };

    const myCenterX = myX + BALL_SIZE / 2;
    const myCenterY = myY + BALL_SIZE / 2;
    const otherCenterX = other.x + other.size / 2;
    const otherCenterY = other.y + other.size / 2;

    const dx = myCenterX - otherCenterX;
    const dy = myCenterY - otherCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = BALL_SIZE / 2 + other.size / 2 + 12;

    if (dist < minDist && dist > 0) {
      const pushX = (dx / dist) * (minDist - dist);
      const pushY = (dy / dist) * (minDist - dist);
      return {
        x: Math.min(constraints.maxX, Math.max(constraints.minX, myX + pushX)),
        y: Math.min(constraints.maxY, Math.max(constraints.minY, myY + pushY)),
      };
    }
    return { x: myX, y: myY };
  };

  // PanResponder：全屏自由拖动 + 点击检测
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
          const s = stateRef.current;
          const pp = getPerPersonNutrition(s.totalNutrition, s.personCount);
          log.info('TAP', { calories: Math.round(pp.calories) });
          dispatch({ type: 'OPEN_SHEET' });
        }
      },
    }),
  ).current;

  // 阶段/模式变化时重置位置
  useEffect(() => {
    lastPos.current = { x: defaultX, y: defaultY };
    positionAnim.setValue({ x: defaultX, y: defaultY });
    onPositionUpdate?.(defaultX, defaultY);
    log.info('BALL_REPOSITION', { stage: cookingState.session?.status || '', isInteractive, bottomOffset });
  }, [bottomOffset]);

  // 显示/隐藏
  useEffect(() => {
    if (state.isVisible) {
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
  }, [state.isVisible]);

  useEffect(() => {
    if (state.isVisible) {
      log.info('BALL_MOUNT', { calories: Math.round(state.totalNutrition?.calories || 0), personCount: state.personCount });
    }
  }, [state.isVisible]);

  if (!state.isVisible && (scaleAnim as any)._value === 0) return null;

  const perPerson = getPerPersonNutrition(state.totalNutrition, state.personCount);
  const calories = Math.round(perPerson.calories);

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
      <Text style={styles.calText}>{calories > 0 ? calories : '0'}</Text>
      <Text style={styles.calUnit}>大卡</Text>
      {state.accuracy === 'precise' && <View style={styles.preciseDot} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ball: {
    position: 'absolute',
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  calText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textWhite,
  },
  calUnit: {
    fontSize: 9,
    color: COLORS.textWhite,
    opacity: 0.8,
  },
  preciseDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2D9F4E',
    borderWidth: 1.5,
    borderColor: COLORS.textWhite,
  },
});
