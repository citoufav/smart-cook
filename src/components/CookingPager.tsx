import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCooking } from '../contexts/CookingContext';
import { cookingProgressService } from '../services/cookingProgressService';
import { getStageIndex, STAGE_KEYS } from '../types';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import CookingProgressBar from './CookingProgressBar';
import { Stage1MenuContent } from '../../app/cooking/stage1-menu';
import { Stage2WeighingContent } from '../../app/cooking/stage2-weighing';
import { Stage3PrepContent } from '../../app/cooking/stage3-prep';
import { Stage4BowlContent } from '../../app/cooking/stage4-bowl';
import { Stage5CookingContent } from '../../app/cooking/stage5-cooking';

const STAGE_LABELS = ['菜单确认', '称量与调料', '切菜备菜', '分装成碗', '按碗炒制'];

/** 锁定状态的占位页面 */
function LockedPlaceholder({ stageName }: { stageName: string }) {
  return (
    <View style={lockedStyles.container}>
      <Ionicons name="lock-closed-outline" size={48} color={COLORS.textTertiary} />
      <Text style={lockedStyles.title}>{stageName}</Text>
      <Text style={lockedStyles.hint}>请先完成前面的步骤</Text>
    </View>
  );
}

const lockedStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background, padding: 40 },
  title: { fontSize: TYPOGRAPHY.h4, fontWeight: '600', color: COLORS.textSecondary, marginTop: 16, marginBottom: 8 },
  hint: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textTertiary },
});

interface CookingPagerProps {
  initialStage?: string;
  historyMode?: boolean;
}

export default function CookingPager({ initialStage, historyMode }: CookingPagerProps) {
  const { state, dispatch } = useCooking();
  const insets = useSafeAreaInsets();

  const session = state.session;
  if (!session) return null;

  const statusIndex = getStageIndex(session.status);
  // historyMode下，非STAGE_KEYS状态回退到最后一个可查看阶段
  const fallbackIndex = historyMode && statusIndex < 0 ? session.completedStageIndex : statusIndex;
  const currentLabel = fallbackIndex >= 0 ? STAGE_LABELS[fallbackIndex] : '准备做菜';

  // 当前应当显示的阶段索引
  const effectiveIndex = historyMode
    ? (initialStage ? Math.max(0, getStageIndex(initialStage as any)) : Math.max(0, fallbackIndex))
    : Math.max(statusIndex, session.completedStageIndex + 1);

  // 进度条点击跳转
  const handleProgressBarPress = useCallback(
    (stageKey: string) => {
      const idx = getStageIndex(stageKey as any);
      const maxAccessible = historyMode
        ? session.completedStageIndex
        : Math.max(statusIndex, session.completedStageIndex + 1);
      console.log('[PAGER] handleProgressBarPress | stageKey:', stageKey, '| idx:', idx, '| maxAccessible:', maxAccessible, '| historyMode:', historyMode, '| statusIndex:', statusIndex, '| completedStageIndex:', session.completedStageIndex);
      if (idx > maxAccessible) {
        console.log('[PAGER] → 阻止：idx > maxAccessible');
        return;
      }
      console.log('[PAGER] → 允许跳转，dispatch SET_CURRENT_STAGE');
      dispatch({ type: 'SET_CURRENT_STAGE', payload: stageKey as any });
    },
    [statusIndex, session.completedStageIndex, historyMode, dispatch],
  );

  // 阶段完成回调
  const handleStageComplete = useCallback(() => {
    const currentIdx = getStageIndex(session.status);
    console.log('[PAGER] handleStageComplete | session.status:', session.status, '| idx:', currentIdx, '| completedStageIndex:', session.completedStageIndex);
    const nextIndex = currentIdx + 1;
    if (nextIndex >= STAGE_KEYS.length) {
      console.log('[PAGER] → 最后阶段，跳转 inventory-update');
      router.push('/cooking/inventory-update');
      return;
    }
    console.log('[PAGER] → dispatch SET_CURRENT_STAGE', STAGE_KEYS[nextIndex]);
    dispatch({ type: 'SET_CURRENT_STAGE', payload: STAGE_KEYS[nextIndex] });
    // 每完成一个阶段立即持久化进度
    if (session) {
      cookingProgressService.save(session).catch(() => {});
    }
  }, [session, dispatch]);

  // 计算当前阶段模式
  const getMode = (stageIndex: number) => {
    if (historyMode) {
      return stageIndex <= session.completedStageIndex ? 'readonly' : 'locked';
    }
    const eff = Math.max(statusIndex, session.completedStageIndex + 1);
    if (stageIndex < eff) return 'readonly';
    if (stageIndex === eff) return 'interactive';
    return 'locked';
  };

  // 渲染当前阶段
  const renderCurrentStage = () => {
    const mode = getMode(effectiveIndex);

    if (mode === 'locked') {
      return <LockedPlaceholder stageName={STAGE_LABELS[effectiveIndex]} />;
    }

    const commonProps = { mode: mode as 'readonly' | 'interactive' };

    switch (effectiveIndex) {
      case 0:
        return <Stage1MenuContent {...commonProps} onComplete={handleStageComplete} />;
      case 1:
        return <Stage2WeighingContent {...commonProps} onComplete={handleStageComplete} />;
      case 2:
        return <Stage3PrepContent {...commonProps} onComplete={handleStageComplete} />;
      case 3:
        return <Stage4BowlContent {...commonProps} onComplete={handleStageComplete} />;
      case 4:
        return <Stage5CookingContent {...commonProps} onComplete={handleStageComplete} />;
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {/* 顶部步骤状态栏 */}
      <View style={[styles.headerBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerStep}>{currentLabel}</Text>
        {historyMode && <Text style={styles.headerBadge}>查看记录</Text>}
      </View>

      {/* 当前阶段内容 */}
      <View style={styles.stageContent}>
        {renderCurrentStage()}
      </View>

      <CookingProgressBar
        currentStage={historyMode ? (fallbackIndex >= 0 ? STAGE_KEYS[fallbackIndex] : session.status) : session.status}
        completedStages={STAGE_KEYS.slice(0, Math.max(0, session.completedStageIndex + 1))}
        readonly={historyMode}
        onStagePress={handleProgressBarPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerStep: {
    fontSize: TYPOGRAPHY.h4,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  headerBadge: {
    marginLeft: 10,
    fontSize: TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
    backgroundColor: COLORS.neutralLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  stageContent: { flex: 1 },
});
