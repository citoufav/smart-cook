import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';
import { getStageIndex } from '../types';

export const PROGRESS_STAGES = [
  { key: 'menu', label: '菜谱', route: '/cooking/stage1-menu' },
  { key: 'weighing', label: '称量', route: '/cooking/stage2-weighing' },
  { key: 'prep', label: '备菜', route: '/cooking/stage3-prep' },
  { key: 'bowl', label: '分装', route: '/cooking/stage4-bowl' },
  { key: 'cooking', label: '制作', route: '/cooking/stage5-cooking' },
] as const;

export type ProgressStageKey = (typeof PROGRESS_STAGES)[number]['key'];

interface CookingProgressBarProps {
  currentStage: string;
  completedStages: string[];
  readonly?: boolean;
  /** Pager 模式下通过回调通知跳转，而非 router.push */
  onStagePress?: (stageKey: string) => void;
}

export default function CookingProgressBar({
  currentStage,
  completedStages,
  readonly,
  onStagePress,
}: CookingProgressBarProps) {
  const currentIndex = getStageIndex(currentStage as any);

  const getStatus = (stageKey: string, index: number) => {
    if (stageKey === currentStage) return 'current';
    if (completedStages.includes(stageKey) || index < currentIndex) return 'done';
    return 'future';
  };

  const handleStagePress = (stageKey: string, index: number) => {
    const status = getStatus(stageKey, index);
    // console.log('[PROGRESS] handleStagePress | stageKey=', stageKey, '| index=', index, '| status=', status, '| hasOnStagePress=', !!onStagePress, '| currentStage=', currentStage, '| currentIndex=', currentIndex, '| completedStages=', completedStages);
    if (status === 'future') {
      // console.log('[PROGRESS] → 跳过(future)');
      return;
    }

    if (onStagePress) {
      // console.log('[PROGRESS] → 调用 onStagePress(', stageKey, ')');
      onStagePress(stageKey);
      return;
    }

    // console.log('[PROGRESS] → 无 onStagePress，忽略点击');
  };

  return (
    <View style={styles.container}>
      {PROGRESS_STAGES.map((stage, index) => {
        const status = getStatus(stage.key, index);
        const isLast = index === PROGRESS_STAGES.length - 1;

        return (
          <React.Fragment key={stage.key}>
            <TouchableOpacity
              style={styles.nodeWrapper}
              onPress={() => handleStagePress(stage.key, index)}
              activeOpacity={status === 'future' ? 1 : 0.6}
              disabled={status === 'future'}
            >
              <View
                style={[
                  styles.dot,
                  status === 'current' && styles.dotCurrent,
                  status === 'done' && styles.dotDone,
                  status === 'future' && styles.dotFuture,
                ]}
              />
              <Text
                style={[
                  styles.label,
                  status === 'current' && styles.labelCurrent,
                  status === 'done' && styles.labelDone,
                  status === 'future' && styles.labelFuture,
                ]}
              >
                {stage.label}
              </Text>
            </TouchableOpacity>
            {!isLast && (
              <View
                style={[
                  styles.line,
                  (status === 'done' || status === 'current') && index < currentIndex
                    ? styles.lineDone
                    : undefined,
                ]}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const DOT_SIZE = 12;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  nodeWrapper: {
    alignItems: 'center',
    minWidth: 44,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginBottom: 4,
  },
  dotCurrent: {
    backgroundColor: COLORS.primary,
    width: DOT_SIZE + 4,
    height: DOT_SIZE + 4,
    borderRadius: (DOT_SIZE + 4) / 2,
  },
  dotDone: {
    backgroundColor: COLORS.primaryLight,
  },
  dotFuture: {
    backgroundColor: COLORS.border,
  },
  line: {
    flex: 1,
    height: 2,
    backgroundColor: COLORS.border,
    marginBottom: 16,
    minWidth: 16,
  },
  lineDone: {
    backgroundColor: COLORS.primaryLight,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
  },
  labelCurrent: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  labelDone: {
    color: COLORS.primaryLight,
  },
  labelFuture: {
    color: COLORS.textTertiary,
  },
});
