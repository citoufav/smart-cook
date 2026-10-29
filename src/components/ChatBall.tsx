import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCooking } from '../contexts/CookingContext';
import { COLORS } from '../constants/colors';
import { DraggableBall, BallRect } from './DraggableBall';

interface ChatBallProps {
  visible: boolean;
  /** Screen coords of the other ball, used for collision detection */
  otherBallRect: React.MutableRefObject<BallRect | null>;
  onPress: () => void;
  /** Position update callback, used for collision detection */
  onPositionUpdate?: (x: number, y: number) => void;
}

/** 聊天悬浮球：点击打开菜谱助手（拖拽/碰撞逻辑见 DraggableBall） */
export function ChatBall({ visible, otherBallRect, onPress, onPositionUpdate }: ChatBallProps) {
  const { state: cookingState } = useCooking();

  // Reserve space for the bottom action bar only during active stages (prep/cooking)
  const isInteractive = useMemo(() => {
    return cookingState.session?.status === 'prep' || cookingState.session?.status === 'cooking';
  }, [cookingState.session?.status]);

  return (
    <DraggableBall
      visible={visible}
      color={COLORS.primary}
      snapSide="left"
      isInteractive={isInteractive}
      otherBallRect={otherBallRect}
      onPositionUpdate={onPositionUpdate}
      onPress={onPress}
    >
      <Ionicons name="chatbubble-ellipses" size={24} color={COLORS.textWhite} />
    </DraggableBall>
  );
}
