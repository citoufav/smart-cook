import React from 'react';
import { Ionicons } from '@expo/vector-icons';
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
  return (
    <DraggableBall
      visible={visible}
      color={COLORS.primary}
      snapSide="left"
      otherBallRect={otherBallRect}
      onPositionUpdate={onPositionUpdate}
      onPress={onPress}
    >
      <Ionicons name="chatbubble-ellipses" size={24} color={COLORS.textWhite} />
    </DraggableBall>
  );
}
