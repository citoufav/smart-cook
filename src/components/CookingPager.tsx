import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  useWindowDimensions,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCooking } from '../contexts/CookingContext';
import { useChatBall } from '../contexts/ChatBallContext';
import { useChatSheet } from '../contexts/ChatSheetContext';
import { getStageIndex, STAGE_KEYS } from '../types';
import { logger } from '../utils/logger';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING } from '../constants/spacing';
import CookingProgressBar from './CookingProgressBar';
import CompletionSheet from './CompletionSheet';
import { RecipeContext } from '../services/chatService';
import { Stage1MenuContent } from '../../app/cooking/stage1-menu';
import { Stage3PrepContent } from '../../app/cooking/stage3-prep';
import { Stage5CookingContent } from '../../app/cooking/stage5-cooking';

const STAGE_LABELS = ['菜谱概览', '备菜步骤', '炒制步骤'];

interface CookingPagerProps {
  initialStage?: string;
  historyMode?: boolean;
}

const log = logger('COMP:PAGER');

export default function CookingPager({ initialStage, historyMode }: CookingPagerProps) {
  const { state, dispatch } = useCooking();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);
  const { showChatBall, hideChatBall, setOnChatPressRef } = useChatBall();
  const { showChatSheet } = useChatSheet();

  const session = state.session;
  const statusIndex = getStageIndex(session?.status ?? 'requirement');

  // Initial page: jump to the last stage with data when viewing history
  const initialPage = historyMode
    ? (session?.stages.menu?.menuProposal?.dishes?.some((d) => d.cookingSteps.length) ? 2
        : session?.stages.menu?.menuProposal?.dishes?.some((d) => d.prepSteps.length) ? 1
        : 0)
    : statusIndex < 0 ? 0 : statusIndex;

  useEffect(() => {
    log.info('MOUNT', { historyMode, initialPage });
    // Sync the initial page: ScrollView position + currentPage state
    setTimeout(() => {
      scrollRef.current?.scrollTo({ x: initialPage * screenWidth, y: 0, animated: false });
      setCurrentPage(initialPage);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build recipe context for the chat sheet (single source of truth: menu.menuProposal)
  const recipeContext: RecipeContext = useMemo(() => {
    const mp = session?.stages?.menu?.menuProposal;
    return {
      dishes: mp?.dishes || [],
      sessionId: session?.id || '',
    };
  }, [session?.stages, session?.id]);

  useEffect(() => {
    if (!session) return;
    log.info('RENDER', { historyMode, status: session.status });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Control chat ball visibility and press behavior via ref (avoids parent re-render)
  useEffect(() => {
    if (historyMode) {
      hideChatBall();
    } else {
      showChatBall();
      setOnChatPressRef(() => showChatSheet(recipeContext));
    }
    return () => {
      hideChatBall();
    };
  }, [historyMode, showChatBall, hideChatBall, setOnChatPressRef, recipeContext, showChatSheet]);

  // Progress bar tap-to-jump + scroll sync
  // 注意：hooks 必须无条件调用，全部放在 early return 之前（rules-of-hooks）
  const handleProgressBarPress = useCallback(
    (stageKey: string) => {
      const idx = getStageIndex(stageKey as any);
      if (idx < 0) return;
      scrollRef.current?.scrollTo({ x: idx * screenWidth, animated: true });
    },
    [screenWidth],
  );

  // Scroll event: sync current page
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      const page = Math.round(offsetX / screenWidth);
      if (page !== currentPage) {
        setCurrentPage(page);
        const stageKey = STAGE_KEYS[page];
        if (stageKey) {
          dispatch({ type: 'SET_CURRENT_STAGE', payload: stageKey as any });
        }
      }
    },
    [currentPage, screenWidth, dispatch],
  );

  if (!session) return null;

  const currentLabel = STAGE_LABELS[currentPage] || '菜谱概览';

  return (
    <View style={styles.container}>
      {/* Top stage status bar */}
      <View style={[styles.headerBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerStep}>{currentLabel}</Text>
        {historyMode && <Text style={styles.headerBadge}>查看记录</Text>}
      </View>

      {/* Three horizontally swipeable pages */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={styles.stageContent}
      >
        <View style={{ width: screenWidth, flex: 1 }}>
          <Stage1MenuContent />
        </View>
        <View style={{ width: screenWidth, flex: 1 }}>
          <Stage3PrepContent />
        </View>
        <View style={{ width: screenWidth, flex: 1 }}>
          <Stage5CookingContent />
        </View>
      </ScrollView>

      {/* Done button */}
      {!historyMode && (
        <TouchableOpacity
          style={styles.completeBtn}
          onPress={() => setShowCompletion(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.completeBtnText}>完成做菜</Text>
        </TouchableOpacity>
      )}

      <CookingProgressBar
        currentStage={STAGE_KEYS[currentPage] || 'menu'}
        completedStages={[]}
        readonly={historyMode}
        onStagePress={handleProgressBarPress}
        maxAccessibleIndex={2}
        allAccessible
      />

      <CompletionSheet
        visible={showCompletion}
        onClose={() => setShowCompletion(false)}
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
  completeBtn: {
    marginHorizontal: SPACING.lg,
    marginVertical: SPACING.xs,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#2D9F4E',
    alignItems: 'center',
  },
  completeBtnText: {
    fontSize: TYPOGRAPHY.body,
    fontWeight: '700',
    color: COLORS.textWhite,
  },
});
