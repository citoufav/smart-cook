import React, { useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Animated,
  PanResponder,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNutrition } from '../contexts/NutritionContext';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SHADOWS } from '../constants/spacing';
import { getPerPersonNutrition } from '../utils/nutrition';

const BALL_SIZE = 56;
const EDGE_MARGIN = 16;
const TAB_BAR_HEIGHT = 56;
const FAB_OFFSET = 60;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export function FloatingBall() {
  const { state, dispatch } = useNutrition();
  const insets = useSafeAreaInsets();

  const positionAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const constraints = useMemo(() => {
    const tabBarSafeArea = insets.bottom + TAB_BAR_HEIGHT;
    return {
      minX: insets.left + EDGE_MARGIN,
      maxX: SCREEN_WIDTH - BALL_SIZE - insets.right - EDGE_MARGIN,
      minY: insets.top + EDGE_MARGIN,
      maxY: SCREEN_HEIGHT - BALL_SIZE - EDGE_MARGIN - tabBarSafeArea - 50 - FAB_OFFSET,
    };
  }, [insets]);

  const defaultPosition = useMemo(() => ({
    x: SCREEN_WIDTH - BALL_SIZE - EDGE_MARGIN,
    y: SCREEN_HEIGHT - BALL_SIZE - EDGE_MARGIN - (insets.bottom + TAB_BAR_HEIGHT + 50 + FAB_OFFSET),
  }), [insets]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !state.isDetailOpen,
      onPanResponderGrant: () => {
        Animated.spring(scaleAnim, { toValue: 1.1, useNativeDriver: true }).start();
      },
      onPanResponderMove: (_, gesture) => {
        const newX = Math.min(constraints.maxX, Math.max(constraints.minX, positionAnim.x._value + gesture.dx));
        const newY = Math.min(constraints.maxY, Math.max(constraints.minY, positionAnim.y._value + gesture.dy));
        positionAnim.setValue({ x: newX, y: newY });
      },
      onPanResponderRelease: (_, gesture) => {
        Animated.spring(scaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }).start();
        const targetX = positionAnim.x._value + gesture.dx > SCREEN_WIDTH / 2
          ? constraints.maxX
          : constraints.minX;
        Animated.spring(positionAnim, {
          toValue: { x: targetX, y: positionAnim.y._value + gesture.dy },
          friction: 7,
          tension: 60,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  // 显示/隐藏动画
  useEffect(() => {
    if (state.isVisible) {
      positionAnim.setValue({ x: defaultPosition.x, y: defaultPosition.y });
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

  if (!state.isVisible && scaleAnim._value === 0) return null;

  console.log('[NUTRITION:BALL] 渲染悬浮球 | totalNutrition:', JSON.stringify(state.totalNutrition), '| personCount:', state.personCount);
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
      <TouchableOpacity
        style={styles.touchable}
        onPress={() => dispatch({ type: 'OPEN_SHEET' })}
        activeOpacity={0.8}
      >
        <Text style={styles.calText}>{calories > 0 ? calories : '0'}</Text>
        <Text style={styles.calUnit}>大卡</Text>
        {state.accuracy === 'precise' && <View style={styles.preciseDot} />}
      </TouchableOpacity>
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
    zIndex: 1000,
  },
  touchable: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
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
