import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCooking } from '../../src/contexts/CookingContext';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS } from '../../src/constants/spacing';
import { Button } from '../../src/components/Button';
import { Checkbox } from '../../src/components/Checkbox';
import { BowlAssignment, StageMode } from '../../src/types';
import { cookingProgressService } from '../../src/services/cookingProgressService';

export default function Stage4BowlScreen() {
  const { state, dispatch } = useCooking();
  const params = useLocalSearchParams<{ readonly?: string }>();
  const isReadonly = params.readonly === '1';
  const generatedPlan = state.session?.stages.generatedPlan;
  const [checkStates, setCheckStates] = useState<Record<number, boolean>>({});

  const allCompletedStages = useMemo(() => {
    if (!isReadonly) return undefined;
    const stages = state.session?.stages;
    const result: string[] = [];
    if (stages?.menu) result.push('menu');
    if (stages?.weighing) result.push('weighing');
    if (stages?.generatedPlan?.prepSteps) result.push('prep');
    if (stages?.generatedPlan?.bowlAssignments) result.push('bowl');
    if (stages?.generatedPlan?.cookingSteps) result.push('cooking');
    return result;
  }, [isReadonly, state.session]);

  // 自动保存进度（非只读模式）
  useFocusEffect(
    useCallback(() => {
      if (state.session && !isReadonly) {
        cookingProgressService.save(state.session).catch(() => {});
      }
    }, [state.session, isReadonly]),
  );

  const bowlAssignments = generatedPlan?.bowlAssignments;

  if (!generatedPlan || !bowlAssignments || bowlAssignments.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>暂无分装数据</Text>
          {generatedPlan && !bowlAssignments && (
            <Text style={styles.emptyHint}>AI 返回的生成方案中缺少分装碗数据，请返回重新生成</Text>
          )}
        </View>
        {/* CookingProgressBar 移至全局 Pager */}
      </View>
    );
  }

  // 按 dishName 分组
  const sections = useMemo(() => {
    const map = new Map<string, BowlAssignment[]>();
    for (const bowl of bowlAssignments) {
      const list = map.get(bowl.dishName) || [];
      list.push(bowl);
      map.set(bowl.dishName, list);
    }
    return [...map.entries()].map(([dishName, bowls]) => ({
      title: dishName,
      data: bowls,
    }));
  }, [bowlAssignments]);

  const totalCount = bowlAssignments.length;
  const completedCount = Object.values(checkStates).filter(Boolean).length;
  const allDone = completedCount === totalCount;

  const handleToggle = (bowlNumber: number) => {
    if (isReadonly) return;
    setCheckStates((prev) => ({ ...prev, [bowlNumber]: !prev[bowlNumber] }));
  };

  const handleComplete = () => {
    dispatch({ type: 'COMPLETE_ALL_BOWLS' });
    router.push('/cooking/stage5-cooking');
  };

  const getDishProgress = (dishName: string) => {
    const bowls = bowlAssignments.filter((b) => b.dishName === dishName);
    const done = bowls.filter((b) => checkStates[b.bowlNumber]).length;
    return `${done}/${bowls.length}`;
  };

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.bowlNumber)}
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {!isReadonly && (
              <Text style={styles.sectionProgress}>{getDishProgress(section.title)} 碗已装好</Text>
            )}
          </View>
        )}
        renderItem={({ item }) => (
          <View style={[styles.bowlRow, (isReadonly ? item.isCompleted : checkStates[item.bowlNumber]) && styles.bowlRowDone]}>
            <Checkbox
              checked={isReadonly ? (item.isCompleted ?? false) : (checkStates[item.bowlNumber] ?? false)}
              onToggle={() => handleToggle(item.bowlNumber)}
              disabled={isReadonly}
              label={`碗${item.bowlNumber}: ${item.contents}`}
            />
          </View>
        )}
      />

      {!isReadonly && (
        <View style={styles.bottomBar}>
          <Button
            title={allDone ? '分装完成，开始炒制' : `已完成 ${completedCount}/${totalCount}`}
            variant={allDone ? 'primary' : 'secondary'}
            size="lg"
            fullWidth
            disabled={!allDone}
            onPress={handleComplete}
          />
        </View>
      )}
      {/* CookingProgressBar 移至全局 Pager */}
    </View>
  );
}

interface Stage4BowlContentProps { mode: 'readonly' | 'interactive'; onComplete?: () => void; }

export function Stage4BowlContent({ mode, onComplete }: Stage4BowlContentProps) {
  const { state, dispatch } = useCooking();
  const isReadonly = mode === 'readonly';
  const generatedPlan = state.session?.stages.generatedPlan;
  const [checkStates, setCheckStates] = useState<Record<number, boolean>>({});

  // 自动保存进度（仅在交互模式下）
  useFocusEffect(
    useCallback(() => {
      if (state.session && mode === 'interactive') {
        cookingProgressService.save(state.session).catch(() => {});
      }
    }, [state.session, mode]),
  );

  const bowlAssignments = generatedPlan?.bowlAssignments;

  if (!generatedPlan || !bowlAssignments || bowlAssignments.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>暂无分装数据</Text>
          {generatedPlan && !bowlAssignments && (
            <Text style={styles.emptyHint}>AI 返回的生成方案中缺少分装碗数据，请返回重新生成</Text>
          )}
        </View>
      </View>
    );
  }

  // 按 dishName 分组
  const sections = useMemo(() => {
    const map = new Map<string, BowlAssignment[]>();
    for (const bowl of bowlAssignments) {
      const list = map.get(bowl.dishName) || [];
      list.push(bowl);
      map.set(bowl.dishName, list);
    }
    return [...map.entries()].map(([dishName, bowls]) => ({
      title: dishName,
      data: bowls,
    }));
  }, [bowlAssignments]);

  const totalCount = bowlAssignments.length;
  const completedCount = Object.values(checkStates).filter(Boolean).length;
  const allDone = completedCount === totalCount;

  const handleToggle = (bowlNumber: number) => {
    if (isReadonly) return;
    setCheckStates((prev) => ({ ...prev, [bowlNumber]: !prev[bowlNumber] }));
  };

  const handleComplete = () => {
    dispatch({ type: 'COMPLETE_ALL_BOWLS' });
    onComplete?.();
  };

  const getDishProgress = (dishName: string) => {
    const bowls = bowlAssignments.filter((b) => b.dishName === dishName);
    const done = bowls.filter((b) => checkStates[b.bowlNumber]).length;
    return `${done}/${bowls.length}`;
  };

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.bowlNumber)}
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {!isReadonly && (
              <Text style={styles.sectionProgress}>{getDishProgress(section.title)} 碗已装好</Text>
            )}
          </View>
        )}
        renderItem={({ item }) => (
          <View style={[styles.bowlRow, (isReadonly ? item.isCompleted : checkStates[item.bowlNumber]) && styles.bowlRowDone]}>
            <Checkbox
              checked={isReadonly ? (item.isCompleted ?? false) : (checkStates[item.bowlNumber] ?? false)}
              onToggle={() => handleToggle(item.bowlNumber)}
              disabled={isReadonly}
              label={`碗${item.bowlNumber}: ${item.contents}`}
            />
          </View>
        )}
      />

      {!isReadonly && (
        <View style={styles.bottomBar}>
          <Button
            title={allDone ? '分装完成，开始炒制' : `已完成 ${completedCount}/${totalCount}`}
            variant={allDone ? 'primary' : 'secondary'}
            size="lg"
            fullWidth
            disabled={!allDone}
            onPress={handleComplete}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  listContent: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: TYPOGRAPHY.body, color: COLORS.textSecondary },
  emptyHint: { fontSize: TYPOGRAPHY.caption, color: COLORS.danger, marginTop: SPACING.sm, textAlign: 'center', paddingHorizontal: SPACING.lg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm, marginTop: SPACING.md },
  sectionTitle: { fontSize: TYPOGRAPHY.h4, fontWeight: '700', color: COLORS.textPrimary },
  sectionProgress: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.primary },
  bowlRow: { backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.xs },
  bowlRowDone: { opacity: 0.6 },
  bottomBar: { padding: SPACING.md, paddingBottom: SPACING.sm, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
});
