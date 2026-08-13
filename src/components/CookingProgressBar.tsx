import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';
import { getStageIndex } from '../types';
import { logger } from '../utils/logger';

export const PROGRESS_STAGES = [
  { key: 'menu', label: '菜谱', route: '/cooking/stage1-menu' },
  { key: 'prep', label: '备菜', route: '/cooking/stage3-prep' },
  { key: 'cooking', label: '炒制', route: '/cooking/stage5-cooking' },
] as const;

export type ProgressStageKey = (typeof PROGRESS_STAGES)[number]['key'];

interface CookingProgressBarProps {
  currentStage: string;
  completedStages: string[];
  readonly?: boolean;
  /** Pager 模式下通过回调通知跳转，而非 router.push */
  onStagePress?: (stageKey: string) => void;
  /** 进度条可访问的最大阶段索引（0-based）。超出此索引的阶段不可点击 */
  maxAccessibleIndex?: number;
  /** 所有阶段统一样式，无 future/accessible 区分 */
  allAccessible?: boolean;
}

const log = logger('COMP:PROGRESS');

export default function CookingProgressBar({
  currentStage,
  completedStages,
  readonly,
  onStagePress,
  maxAccessibleIndex,
  allAccessible,
}: CookingProgressBarProps) {
  const currentIndex = getStageIndex(currentStage as any);

  const getStatus = (stageKey: string, index: number) => {
    if (stageKey === currentStage) return 'current';
    // allAccessible 模式下统一返回 accessible（无未来/已完成区分）
    if (allAccessible) return 'accessible';
    if (completedStages.includes(stageKey)) return 'done';
    if (index < currentIndex) return 'done';
    if (maxAccessibleIndex !== undefined && index <= maxAccessibleIndex) return 'accessible';
    return 'future';
  };

  const handleStagePress = (stageKey: string, index: number) => {
    const status = getStatus(stageKey, index);
    // allAccessible 或非 future 均可点击
    if (!allAccessible && status === 'future') return;

    if (onStagePress) {
      onStagePress(stageKey);
    }
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
              activeOpacity={allAccessible || status !== 'future' ? 0.6 : 1}
              disabled={!allAccessible && status === 'future'}
            >
              <View
                style={[
                  styles.dot,
                  status === 'current' && styles.dotCurrent,
                  status === 'done' && styles.dotDone,
                  status === 'accessible' && styles.dotAccessible,
                  status === 'future' && styles.dotFuture,
                ]}
              />
              <Text
                style={[
                  styles.label,
                  status === 'current' && styles.labelCurrent,
                  status === 'done' && styles.labelDone,
                  status === 'accessible' && styles.labelAccessible,
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
  dotAccessible: {
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.primaryLight,
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
  labelAccessible: {
    color: COLORS.primaryLight,
  },
  labelFuture: {
    color: COLORS.textTertiary,
  },
});
