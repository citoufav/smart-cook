import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useNutrition } from '../contexts/NutritionContext';
import { COLORS } from '../constants/colors';
import { getPerPersonNutrition } from '../utils/nutrition';
import { DraggableBall, BallRect } from './DraggableBall';

interface FloatingBallProps {
  /** Screen coords of the other ball, used for collision detection */
  otherBallRect?: React.MutableRefObject<BallRect | null>;
  /** Position update callback, used for collision detection */
  onPositionUpdate?: (x: number, y: number) => void;
}

/** 营养悬浮球：显示每人摄入大卡，点击打开营养详情（拖拽/碰撞逻辑见 DraggableBall） */
export function FloatingBall({ otherBallRect, onPositionUpdate }: FloatingBallProps) {
  const { state, dispatch } = useNutrition();

  const perPerson = getPerPersonNutrition(state.totalNutrition, state.personCount);
  const calories = Math.round(perPerson.calories);

  return (
    <DraggableBall
      visible={state.isVisible}
      color={COLORS.primary}
      snapSide="right"
      otherBallRect={otherBallRect}
      onPositionUpdate={onPositionUpdate}
      onPress={() => dispatch({ type: 'OPEN_SHEET' })}
    >
      <Text style={styles.calText}>{calories > 0 ? calories : '0'}</Text>
      <Text style={styles.calUnit}>大卡</Text>
      {state.accuracy === 'precise' && <View style={styles.preciseDot} />}
    </DraggableBall>
  );
}

const styles = StyleSheet.create({
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
