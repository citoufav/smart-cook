import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Alert,
  StyleSheet,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCooking } from '../../src/contexts/CookingContext';
import { useSettings } from '../../src/contexts/SettingsContext';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS } from '../../src/constants/spacing';
import { Button } from '../../src/components/Button';
import { Checkbox } from '../../src/components/Checkbox';
import { LoadingOverlay } from '../../src/components/LoadingOverlay';
import { callAIStage2Stream, callAIPatch, buildIngredientTags } from '../../src/services/aiService';
import { validateBowlReferences } from '../../src/utils/bowlValidation';
import { cookingProgressService } from '../../src/services/cookingProgressService';
import { SSEStreamController } from '../../src/utils/sseStream';
import { MAX_PATCH_ATTEMPTS, BASE_RETRY_DELAY_MS } from '../../src/constants/cooking';

import { StageMode } from '../../src/types';

const STALL_TIMEOUT_MS = 20_000;

interface WeighedItem {
  name: string;
  dishName: string;
  estimatedWeight: number;
  actualWeight: string;
}

export default function Stage2WeighingScreen() {
  const params = useLocalSearchParams<{ readonly?: string }>();
  const isReadonly = params.readonly === '1';
  const { state: cookingState, setStage2Result, setCurrentStage } = useCooking();
  const { state: settingsState } = useSettings();
  const menuProposal = cookingState.session?.stages.menu?.menuProposal;
  const savedWeighing = cookingState.session?.stages.weighing;
  const inventorySeasons = [] as any[]; // Will use from inventory context

  const [screenState, setScreenState] = useState<'confirming' | 'generating' | 'validating' | 'patching' | 'ready' | 'error'>('confirming');
  const [patchingAttempt, setPatchingAttempt] = useState(0);
  const [thinkingText, setThinkingText] = useState('');
  const [isStalled, setIsStalled] = useState(false);

  const streamRef = useRef<SSEStreamController | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const resetStallTimer = useCallback(() => {
    clearStallTimer();
    setIsStalled(false);
    stallTimerRef.current = setTimeout(() => {
      setIsStalled(true);
    }, STALL_TIMEOUT_MS);
  }, [clearStallTimer]);

  // 构建称量列表
  const weighedItems: WeighedItem[] = useMemo(() => {
    if (!menuProposal) return [];
    // 只读模式：使用已保存的称量数据
    if (isReadonly && savedWeighing) {
      const items: WeighedItem[] = [];
      for (const dish of menuProposal.dishes) {
        for (const ing of dish.ingredients) {
          const saved = savedWeighing.actualWeights.find(
            (w) => w.ingredientName === ing.name,
          );
          items.push({
            name: ing.name,
            dishName: dish.name,
            estimatedWeight: ing.estimatedWeight,
            actualWeight: saved ? String(saved.actualWeight) : String(ing.estimatedWeight),
          });
        }
      }
      return items;
    }
    const items: WeighedItem[] = [];
    for (const dish of menuProposal.dishes) {
      for (const ing of dish.ingredients) {
        items.push({
          name: ing.name,
          dishName: dish.name,
          estimatedWeight: ing.estimatedWeight,
          actualWeight: String(ing.estimatedWeight),
        });
      }
    }
    return items;
  }, [menuProposal, isReadonly, savedWeighing]);

  // 收集所有调料名并去重
  const allSeasonings: { name: string; status: string }[] = useMemo(() => {
    if (!menuProposal) return [];
    const names = new Set<string>();
    for (const dish of menuProposal.dishes) {
      for (const s of dish.seasonings) {
        names.add(s.name);
      }
    }
    return [...names].map((name) => {
      const inv = inventorySeasons.find((s: any) => s.name === name);
      return { name, status: inv?.status || 'out' };
    });
  }, [menuProposal]);

  const [seasoningChecks, setSeasoningChecks] = useState<Record<string, boolean>>(() => {
    const checks: Record<string, boolean> = {};
    if (isReadonly && savedWeighing) {
      // 只读模式：使用已保存的调料勾选状态
      for (const s of allSeasonings) {
        const saved = savedWeighing.availableSeasonings.find(
          (av) => av.seasoningName === s.name,
        );
        checks[s.name] = saved ? saved.isAvailable : false;
      }
    } else {
      for (const s of allSeasonings) {
        checks[s.name] = s.status !== 'out';
      }
    }
    return checks;
  });

  const [focusedInputIndex, setFocusedInputIndex] = useState<number | null>(null);

  // 从 session 推导只读模式下的已完成阶段
  const allCompletedStages = useMemo(() => {
    if (!isReadonly) return undefined;
    const stages = cookingState.session?.stages;
    const result: string[] = [];
    if (stages?.menu) result.push('menu');
    if (stages?.weighing) result.push('weighing');
    if (stages?.generatedPlan?.prepSteps) result.push('prep');
    if (stages?.generatedPlan?.bowlAssignments) result.push('bowl');
    if (stages?.generatedPlan?.cookingSteps) result.push('cooking');
    return result;
  }, [isReadonly, cookingState.session]);

  if (!menuProposal) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>暂无数据</Text>
      </View>
    );
  }

  const handleWeightChange = (index: number, value: string) => {
    const num = parseFloat(value);
    weighedItems[index].actualWeight = isNaN(num) ? '0' : value;
  };

  const handleRetry = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.abort();
      streamRef.current = null;
    }
    clearStallTimer();
    handleSubmit();
  }, [clearStallTimer]);

  const handleSubmit = async () => {
    setScreenState('generating');
    setThinkingText('');
    setIsStalled(false);

    const input = {
      dishes: menuProposal.dishes.map((dish: any) => ({
        name: dish.name,
        ingredients: dish.ingredients.map((ing: any) => {
          const weighed = weighedItems.find((w) => w.name === ing.name && w.dishName === dish.name);
          return {
            name: ing.name,
            actualGrams: weighed ? (parseFloat(weighed.actualWeight) || ing.estimatedWeight) : ing.estimatedWeight,
          };
        }),
      })),
      availableSeasonings: allSeasonings.filter((s) => seasoningChecks[s.name]).map((s) => s.name),
      peopleCount: cookingState.session?.stages.requirement?.personCount || 2,
      mealType: cookingState.session?.stages.requirement?.mealType || 'any',
      calorieTarget: cookingState.session?.stages.requirement?.caloriePreference,
    };

    const processResult = async (response: any) => {
      // 验证碗引用
      setScreenState('validating');
      const bowlAssignments = response.bowlAssignments || [];
      const cookingSteps = response.cookingSteps || [];
      const validationResult = validateBowlReferences(bowlAssignments, cookingSteps);

      // 需要修补
      let currentResponse = response;
      let attempts = 0;
      while (!validationResult.isValid && attempts < MAX_PATCH_ATTEMPTS) {
        attempts++;
        setPatchingAttempt(attempts);
        setScreenState('patching');
        await new Promise((r) => setTimeout(r, BASE_RETRY_DELAY_MS * Math.pow(2, attempts - 1)));

        const errorOnly = validationResult.errors.filter((e: any) => e.severity === 'error');
        if (errorOnly.length > 0) {
          try {
            currentResponse = await callAIPatch(currentResponse, errorOnly, settingsState.preferences);
            const newValidation = validateBowlReferences(currentResponse.bowlAssignments, currentResponse.cookingSteps);
            if (newValidation.isValid) {
              onSuccess(currentResponse);
              return;
            }
            // 更新验证结果用于下一次循环
            Object.assign(validationResult, newValidation);
          } catch {
            break;
          }
        } else {
          break;
        }
      }

      if (!validationResult.isValid && attempts >= MAX_PATCH_ATTEMPTS) {
        Alert.alert(
          '验证失败',
          `经过 ${attempts} 次自动修正仍无法通过验证。请检查称量数据后重试。`,
          [
            { text: '返回修改', onPress: () => { clearStallTimer(); setScreenState('confirming'); } },
            { text: '忽略并继续', onPress: () => onSuccess(currentResponse) },
          ],
        );
        setScreenState('error');
        return;
      }

      onSuccess(currentResponse);
    };

    const stream = callAIStage2Stream(
      input,
      settingsState.preferences,
      {
        onReasoning: (text: string) => {
          setThinkingText((prev) => prev + text);
          resetStallTimer();
        },
        onContent: () => {
          resetStallTimer();
        },
        onData: () => {
          resetStallTimer();
        },
        onDone: (result: any) => {
          clearStallTimer();
          processResult(result);
        },
        onError: (error: Error) => {
          clearStallTimer();
          setScreenState('error');
          Alert.alert('AI 方案生成失败', error.message || '请检查网络后重试', [
            { text: '返回修改', onPress: () => setScreenState('confirming') },
            { text: '重试', onPress: () => handleSubmit() },
          ]);
        },
      },
    );

    streamRef.current = stream;
    resetStallTimer();
  };

  const onSuccess = (response: any) => {
    setScreenState('ready');
    
    // 保存到 Context
    const weighingData = {
      actualWeights: weighedItems.map((w) => ({
        ingredientName: w.name,
        estimatedWeight: w.estimatedWeight,
        actualWeight: parseFloat(w.actualWeight) || w.estimatedWeight,
        usedInDishes: [w.dishName],
      })),
      availableSeasonings: allSeasonings.map((s) => ({
        seasoningName: s.name,
        isAvailable: seasoningChecks[s.name] ?? false,
      })),
    };

    // 生成食材标签
    const stage2Input: any = {
      dishes: menuProposal.dishes.map((dish: any) => ({
        name: dish.name,
        ingredients: dish.ingredients.map((ing: any) => {
          const weighed = weighedItems.find((w) => w.name === ing.name && w.dishName === dish.name);
          return {
            name: ing.name,
            actualGrams: weighed ? (parseFloat(weighed.actualWeight) || ing.estimatedWeight) : ing.estimatedWeight,
          };
        }),
      })),
      availableSeasonings: allSeasonings.filter((s) => seasoningChecks[s.name]).map((s) => s.name),
      peopleCount: cookingState.session?.stages.requirement?.personCount || 2,
      mealType: cookingState.session?.stages.requirement?.mealType || 'any',
      calorieTarget: cookingState.session?.stages.requirement?.caloriePreference,
    };
    const ingredientTags = buildIngredientTags(stage2Input);
    const generatedPlanWithTags = { ...response, ingredientTags };

    setStage2Result(weighingData, generatedPlanWithTags);
    setCurrentStage('prep');

    // 自动保存进度
    if (cookingState.session) {
      const updatedSession = {
        ...cookingState.session,
        status: 'prep' as const,
        stages: {
          ...cookingState.session.stages,
          weighing: weighingData,
          generatedPlan: generatedPlanWithTags,
        },
        updatedAt: new Date().toISOString(),
      };
      cookingProgressService.save(updatedSession).catch(() => {});
    }

    // 精确营养将在进入备菜阶段（stage3）时弹出

    router.replace('/cooking/stage3-prep');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>确认食材重量</Text>
        {!isReadonly && (
          <Text style={styles.hint}>请确认实际重量，或手动调整</Text>
        )}

        {weighedItems.map((item, index) => (
          <View key={`${item.dishName}-${item.name}`} style={styles.weighRow}>
            <View style={styles.weighInfo}>
              <Text style={styles.weighName}>{item.name}</Text>
              <Text style={styles.weighDish}>{item.dishName}</Text>
            </View>
            {isReadonly ? (
              <Text style={{ fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.primary, width: 80, textAlign: 'right' }}>{item.actualWeight}g</Text>
            ) : (
              <View style={[styles.weighInput, focusedInputIndex === index && styles.weighInputFocused]}>
                <TextInput
                  style={styles.weighInputText}
                  value={item.actualWeight}
                  onChangeText={(v) => handleWeightChange(index, v.replace(/[^0-9]/g, ''))}
                  onFocus={() => setFocusedInputIndex(index)}
                  onBlur={() => setFocusedInputIndex(null)}
                  keyboardType="numeric"
                  selectTextOnFocus
                />
                <Text style={styles.weighUnit}>g</Text>
              </View>
            )}
            <Text style={styles.estText}>AI预估: {item.estimatedWeight}g</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>可用调料</Text>
        {allSeasonings.map((s) => (
          <View key={s.name} style={styles.seasoningRow}>
            <Checkbox
              checked={seasoningChecks[s.name] ?? false}
              onToggle={(checked) => {
                if (isReadonly) return;
                setSeasoningChecks((prev) => ({ ...prev, [s.name]: checked }));
              }}
              label={s.name}
            />
          </View>
        ))}
      </ScrollView>

      {!isReadonly && (
        <View style={styles.bottomBar}>
          <Button
            title={screenState === 'generating' || screenState === 'validating' || screenState === 'patching' ? '生成中...' : '确认称量，生成方案'}
            variant="primary"
            size="lg"
            fullWidth
            disabled={screenState !== 'confirming'}
            onPress={handleSubmit}
          />
        </View>
      )}

      <LoadingOverlay
        visible={screenState === 'generating' || screenState === 'validating' || screenState === 'patching'}
        thinkingText={thinkingText}
        isStalled={isStalled && screenState === 'generating'}
        onRetry={screenState === 'generating' ? handleRetry : undefined}
      />

      {/* CookingProgressBar 移至全局 Pager */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: TYPOGRAPHY.body, color: COLORS.textSecondary },
  sectionTitle: { fontSize: TYPOGRAPHY.h3, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.xs, marginTop: SPACING.lg },
  hint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginBottom: SPACING.md },
  weighRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.sm },
  weighInfo: { flex: 1 },
  weighName: { fontSize: TYPOGRAPHY.body, fontWeight: '500', color: COLORS.textPrimary },
  weighDish: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary },
  weighInput: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.sm, paddingHorizontal: SPACING.sm, width: 80 },
  weighInputFocused: { borderColor: COLORS.primary },
  weighInputText: { flex: 1, fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary, textAlign: 'right' },
  weighUnit: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary },
  estText: { fontSize: 11, color: COLORS.textTertiary, marginLeft: SPACING.sm },
  seasoningRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.xs },
  bottomBar: { padding: SPACING.lg, paddingBottom: SPACING.xl, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
});

interface Stage2WeighingContentProps {
  mode: StageMode;
  onComplete?: () => void;
}

export function Stage2WeighingContent({ mode, onComplete }: Stage2WeighingContentProps) {
  const isReadonly = mode === 'readonly';
  const { state: cookingState, setStage2Result, setCurrentStage } = useCooking();
  const { state: settingsState } = useSettings();
  const menuProposal = cookingState.session?.stages.menu?.menuProposal;
  const savedWeighing = cookingState.session?.stages.weighing;
  const inventorySeasons = [] as any[]; // Will use from inventory context

  const [screenState, setScreenState] = useState<'confirming' | 'generating' | 'validating' | 'patching' | 'ready' | 'error'>('confirming');
  const [patchingAttempt, setPatchingAttempt] = useState(0);
  const [thinkingText, setThinkingText] = useState('');
  const [isStalled, setIsStalled] = useState(false);

  const streamRef = useRef<SSEStreamController | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const resetStallTimer = useCallback(() => {
    clearStallTimer();
    setIsStalled(false);
    stallTimerRef.current = setTimeout(() => {
      setIsStalled(true);
    }, STALL_TIMEOUT_MS);
  }, [clearStallTimer]);

  // 构建称量列表
  const weighedItems: WeighedItem[] = useMemo(() => {
    if (!menuProposal) return [];
    // 只读模式：使用已保存的称量数据
    if (isReadonly && savedWeighing) {
      const items: WeighedItem[] = [];
      for (const dish of menuProposal.dishes) {
        for (const ing of dish.ingredients) {
          const saved = savedWeighing.actualWeights.find(
            (w) => w.ingredientName === ing.name,
          );
          items.push({
            name: ing.name,
            dishName: dish.name,
            estimatedWeight: ing.estimatedWeight,
            actualWeight: saved ? String(saved.actualWeight) : String(ing.estimatedWeight),
          });
        }
      }
      return items;
    }
    const items: WeighedItem[] = [];
    for (const dish of menuProposal.dishes) {
      for (const ing of dish.ingredients) {
        items.push({
          name: ing.name,
          dishName: dish.name,
          estimatedWeight: ing.estimatedWeight,
          actualWeight: String(ing.estimatedWeight),
        });
      }
    }
    return items;
  }, [menuProposal, isReadonly, savedWeighing]);

  // 收集所有调料名并去重
  const allSeasonings: { name: string; status: string }[] = useMemo(() => {
    if (!menuProposal) return [];
    const names = new Set<string>();
    for (const dish of menuProposal.dishes) {
      for (const s of dish.seasonings) {
        names.add(s.name);
      }
    }
    return [...names].map((name) => {
      const inv = inventorySeasons.find((s: any) => s.name === name);
      return { name, status: inv?.status || 'out' };
    });
  }, [menuProposal]);

  const [seasoningChecks, setSeasoningChecks] = useState<Record<string, boolean>>(() => {
    const checks: Record<string, boolean> = {};
    if (isReadonly && savedWeighing) {
      // 只读模式：使用已保存的调料勾选状态
      for (const s of allSeasonings) {
        const saved = savedWeighing.availableSeasonings.find(
          (av) => av.seasoningName === s.name,
        );
        checks[s.name] = saved ? saved.isAvailable : false;
      }
    } else {
      for (const s of allSeasonings) {
        checks[s.name] = s.status !== 'out';
      }
    }
    return checks;
  });

  const [focusedInputIndex, setFocusedInputIndex] = useState<number | null>(null);

  // 从 session 推导只读模式下的已完成阶段
  const allCompletedStages = useMemo(() => {
    if (!isReadonly) return undefined;
    const stages = cookingState.session?.stages;
    const result: string[] = [];
    if (stages?.menu) result.push('menu');
    if (stages?.weighing) result.push('weighing');
    if (stages?.generatedPlan?.prepSteps) result.push('prep');
    if (stages?.generatedPlan?.bowlAssignments) result.push('bowl');
    if (stages?.generatedPlan?.cookingSteps) result.push('cooking');
    return result;
  }, [isReadonly, cookingState.session]);

  if (!menuProposal) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>暂无数据</Text>
      </View>
    );
  }

  const handleWeightChange = (index: number, value: string) => {
    const num = parseFloat(value);
    weighedItems[index].actualWeight = isNaN(num) ? '0' : value;
  };

  const handleRetry = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.abort();
      streamRef.current = null;
    }
    clearStallTimer();
    handleSubmit();
  }, [clearStallTimer]);

  const handleSubmit = async () => {
    setScreenState('generating');
    setThinkingText('');
    setIsStalled(false);

    const input = {
      dishes: menuProposal.dishes.map((dish: any) => ({
        name: dish.name,
        ingredients: dish.ingredients.map((ing: any) => {
          const weighed = weighedItems.find((w) => w.name === ing.name && w.dishName === dish.name);
          return {
            name: ing.name,
            actualGrams: weighed ? (parseFloat(weighed.actualWeight) || ing.estimatedWeight) : ing.estimatedWeight,
          };
        }),
      })),
      availableSeasonings: allSeasonings.filter((s) => seasoningChecks[s.name]).map((s) => s.name),
      peopleCount: cookingState.session?.stages.requirement?.personCount || 2,
      mealType: cookingState.session?.stages.requirement?.mealType || 'any',
      calorieTarget: cookingState.session?.stages.requirement?.caloriePreference,
    };

    const processResult = async (response: any) => {
      // 验证碗引用
      setScreenState('validating');
      const bowlAssignments = response.bowlAssignments || [];
      const cookingSteps = response.cookingSteps || [];
      const validationResult = validateBowlReferences(bowlAssignments, cookingSteps);

      // 需要修补
      let currentResponse = response;
      let attempts = 0;
      while (!validationResult.isValid && attempts < MAX_PATCH_ATTEMPTS) {
        attempts++;
        setPatchingAttempt(attempts);
        setScreenState('patching');
        await new Promise((r) => setTimeout(r, BASE_RETRY_DELAY_MS * Math.pow(2, attempts - 1)));

        const errorOnly = validationResult.errors.filter((e: any) => e.severity === 'error');
        if (errorOnly.length > 0) {
          try {
            currentResponse = await callAIPatch(currentResponse, errorOnly, settingsState.preferences);
            const newValidation = validateBowlReferences(currentResponse.bowlAssignments, currentResponse.cookingSteps);
            if (newValidation.isValid) {
              onSuccess(currentResponse);
              return;
            }
            // 更新验证结果用于下一次循环
            Object.assign(validationResult, newValidation);
          } catch {
            break;
          }
        } else {
          break;
        }
      }

      if (!validationResult.isValid && attempts >= MAX_PATCH_ATTEMPTS) {
        Alert.alert(
          '验证失败',
          `经过 ${attempts} 次自动修正仍无法通过验证。请检查称量数据后重试。`,
          [
            { text: '返回修改', onPress: () => { clearStallTimer(); setScreenState('confirming'); } },
            { text: '忽略并继续', onPress: () => onSuccess(currentResponse) },
          ],
        );
        setScreenState('error');
        return;
      }

      onSuccess(currentResponse);
    };

    const stream = callAIStage2Stream(
      input,
      settingsState.preferences,
      {
        onReasoning: (text: string) => {
          setThinkingText((prev) => prev + text);
          resetStallTimer();
        },
        onContent: () => {
          resetStallTimer();
        },
        onData: () => {
          resetStallTimer();
        },
        onDone: (result: any) => {
          clearStallTimer();
          processResult(result);
        },
        onError: (error: Error) => {
          clearStallTimer();
          setScreenState('error');
          Alert.alert('AI 方案生成失败', error.message || '请检查网络后重试', [
            { text: '返回修改', onPress: () => setScreenState('confirming') },
            { text: '重试', onPress: () => handleSubmit() },
          ]);
        },
      },
    );

    streamRef.current = stream;
    resetStallTimer();
  };

  const onSuccess = (response: any) => {
    setScreenState('ready');
    
    // 保存到 Context
    const weighingData = {
      actualWeights: weighedItems.map((w) => ({
        ingredientName: w.name,
        estimatedWeight: w.estimatedWeight,
        actualWeight: parseFloat(w.actualWeight) || w.estimatedWeight,
        usedInDishes: [w.dishName],
      })),
      availableSeasonings: allSeasonings.map((s) => ({
        seasoningName: s.name,
        isAvailable: seasoningChecks[s.name] ?? false,
      })),
    };

    // 生成食材标签
    const stage2Input: any = {
      dishes: menuProposal.dishes.map((dish: any) => ({
        name: dish.name,
        ingredients: dish.ingredients.map((ing: any) => {
          const weighed = weighedItems.find((w) => w.name === ing.name && w.dishName === dish.name);
          return {
            name: ing.name,
            actualGrams: weighed ? (parseFloat(weighed.actualWeight) || ing.estimatedWeight) : ing.estimatedWeight,
          };
        }),
      })),
      availableSeasonings: allSeasonings.filter((s) => seasoningChecks[s.name]).map((s) => s.name),
      peopleCount: cookingState.session?.stages.requirement?.personCount || 2,
      mealType: cookingState.session?.stages.requirement?.mealType || 'any',
      calorieTarget: cookingState.session?.stages.requirement?.caloriePreference,
    };
    const ingredientTags = buildIngredientTags(stage2Input);
    const generatedPlanWithTags = { ...response, ingredientTags };

    setStage2Result(weighingData, generatedPlanWithTags);
    setCurrentStage('prep');

    // 自动保存进度
    if (cookingState.session) {
      const updatedSession = {
        ...cookingState.session,
        status: 'prep' as const,
        stages: {
          ...cookingState.session.stages,
          weighing: weighingData,
          generatedPlan: generatedPlanWithTags,
        },
        updatedAt: new Date().toISOString(),
      };
      cookingProgressService.save(updatedSession).catch(() => {});
    }

    // 精确营养将在进入备菜阶段（stage3）时弹出

    onComplete?.();
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>确认食材重量</Text>
        {!isReadonly && (
          <Text style={styles.hint}>请确认实际重量，或手动调整</Text>
        )}

        {weighedItems.map((item, index) => (
          <View key={`${item.dishName}-${item.name}`} style={styles.weighRow}>
            <View style={styles.weighInfo}>
              <Text style={styles.weighName}>{item.name}</Text>
              <Text style={styles.weighDish}>{item.dishName}</Text>
            </View>
            {isReadonly ? (
              <Text style={{ fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.primary, width: 80, textAlign: 'right' }}>{item.actualWeight}g</Text>
            ) : (
              <View style={[styles.weighInput, focusedInputIndex === index && styles.weighInputFocused]}>
                <TextInput
                  style={styles.weighInputText}
                  value={item.actualWeight}
                  onChangeText={(v) => handleWeightChange(index, v.replace(/[^0-9]/g, ''))}
                  onFocus={() => setFocusedInputIndex(index)}
                  onBlur={() => setFocusedInputIndex(null)}
                  keyboardType="numeric"
                  selectTextOnFocus
                />
                <Text style={styles.weighUnit}>g</Text>
              </View>
            )}
            <Text style={styles.estText}>AI预估: {item.estimatedWeight}g</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>可用调料</Text>
        {allSeasonings.map((s) => (
          <View key={s.name} style={styles.seasoningRow}>
            <Checkbox
              checked={seasoningChecks[s.name] ?? false}
              onToggle={(checked) => {
                if (isReadonly) return;
                setSeasoningChecks((prev) => ({ ...prev, [s.name]: checked }));
              }}
              label={s.name}
            />
          </View>
        ))}
      </ScrollView>

      {!isReadonly && (
        <View style={styles.bottomBar}>
          <Button
            title={screenState === 'generating' || screenState === 'validating' || screenState === 'patching' ? '生成中...' : '确认称量，生成方案'}
            variant="primary"
            size="lg"
            fullWidth
            disabled={screenState !== 'confirming'}
            onPress={handleSubmit}
          />
        </View>
      )}

      <LoadingOverlay
        visible={screenState === 'generating' || screenState === 'validating' || screenState === 'patching'}
        thinkingText={thinkingText}
        isStalled={isStalled && screenState === 'generating'}
        onRetry={screenState === 'generating' ? handleRetry : undefined}
      />
    </View>
  );
}
