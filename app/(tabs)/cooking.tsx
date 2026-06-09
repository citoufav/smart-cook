import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Alert,
  Modal,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useInventory } from '../../src/contexts/InventoryContext';
import { useCooking } from '../../src/contexts/CookingContext';
import { useSettings } from '../../src/contexts/SettingsContext';
import { useNutrition } from '../../src/contexts/NutritionContext';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import { PEOPLE_OPTIONS, MEAL_TYPE_OPTIONS, CALORIE_OPTIONS } from '../../src/constants/cooking';
import { Button } from '../../src/components/Button';
import { SelectableChip } from '../../src/components/SelectableChip';
import { LoadingOverlay } from '../../src/components/LoadingOverlay';
import { RequirementInput, NutritionalData, InventoryCheckResult, CookingStage } from '../../src/types';
import { callAIStage1Stream } from '../../src/services/aiService';
import { menuHistoryService } from '../../src/services/menuHistoryService';
import { cookingProgressService, CookingProgressRecord, STAGE_LABELS } from '../../src/services/cookingProgressService';
import { SSEStreamController } from '../../src/utils/sseStream';
import { generateId } from '../../src/utils/uuid';

const STALL_TIMEOUT_MS = 20_000;

const STAGE_ROUTES: Record<CookingStage, string> = {
  requirement: '/(tabs)/cooking',
  menu: '/cooking/stage1-menu',
  weighing: '/cooking/stage2-weighing',
  prep: '/cooking/stage3-prep',
  bowl: '/cooking/stage4-bowl',
  cooking: '/cooking/stage5-cooking',
  inventoryUpdate: '/cooking/inventory-update',
  completed: '/(tabs)/cooking',
  cancelled: '/(tabs)/cooking',
};

export default function CookingEntryScreen() {
  const [people, setPeople] = useState(1);
  const [mealType, setMealType] = useState('any');
  const [calorieTarget, setCalorieTarget] = useState<number | undefined>(undefined);
  const [customRequest, setCustomRequest] = useState('');
  const [customPeople, setCustomPeople] = useState<number | null>(null);
  const [customMealType, setCustomMealType] = useState<string>('');
  const [customCalorie, setCustomCalorie] = useState<number | null>(null);
  const [customModal, setCustomModal] = useState<{ visible: boolean; type: 'people' | 'meal' | 'calorie' } | null>(null);
  const [customInputText, setCustomInputText] = useState('');
  const [screenState, setScreenState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [thinkingText, setThinkingText] = useState('');
  const [isStalled, setIsStalled] = useState(false);
  const [progressRecords, setProgressRecords] = useState<CookingProgressRecord[]>([]);

  const streamRef = useRef<SSEStreamController | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingResultRef = useRef<any>(null);

  const { state: invState } = useInventory();
  const { startSession, setStage1Result, restoreSession } = useCooking();
  const { state: settingsState, saveLastCookingDefaults, loadLastCookingDefaults } = useSettings();
  const { setEstimatedNutrition } = useNutrition();
  const { hideBall } = useNutrition();

  // 每次进入做菜 tab 时隐藏悬浮球（用户可能刚从菜谱流程返回）
  useFocusEffect(
    useCallback(() => {
      hideBall();
      // 加载进行中的做菜记录
      cookingProgressService.getAllRecords().then(setProgressRecords).catch(() => {});
    }, [hideBall]),
  );

  // 恢复做菜进度
  const handleResume = useCallback((record: CookingProgressRecord) => {
    restoreSession(record.session);
    // 恢复营养数据
    const dishes = record.session?.stages?.menu?.menuProposal?.dishes;
    if (dishes && dishes.length > 0) {
      const nutritionByDish: Record<string, NutritionalData> = {};
      for (const dish of dishes) {
        if (dish.estimatedNutrition) {
          nutritionByDish[dish.name] = { ...dish.estimatedNutrition, source: 'estimated' as const };
        }
      }
      if (Object.keys(nutritionByDish).length > 0) {
        const pc = record.session?.stages?.requirement?.personCount ?? 1;
        setEstimatedNutrition(nutritionByDish, pc);
      }
    }
    setTimeout(() => {
      router.push('/cooking/pager' as any);
    }, 50);
  }, [restoreSession, setEstimatedNutrition]);

  // 查看记录（只读模式）
  const handleViewRecord = useCallback((record: CookingProgressRecord) => {
    restoreSession(record.session);
    // 恢复营养数据
    const dishes = record.session?.stages?.menu?.menuProposal?.dishes;
    if (dishes && dishes.length > 0) {
      const nutritionByDish: Record<string, NutritionalData> = {};
      for (const dish of dishes) {
        if (dish.estimatedNutrition) {
          nutritionByDish[dish.name] = { ...dish.estimatedNutrition, source: 'estimated' as const };
        }
      }
      if (Object.keys(nutritionByDish).length > 0) {
        const pc = record.session?.stages?.requirement?.personCount ?? 1;
        setEstimatedNutrition(nutritionByDish, pc);
      }
    }
    setTimeout(() => {
      router.push(`/cooking/pager?historyMode=1&initialStage=${record.currentStage}` as any);
    }, 50);
  }, [restoreSession, setEstimatedNutrition]);

  // 删除进度记录
  const handleDeleteRecord = useCallback((record: CookingProgressRecord) => {
    Alert.alert('删除记录', `确定删除「${record.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          cookingProgressService.remove(record.id).then(() => {
            setProgressRecords((prev) => prev.filter((r) => r.id !== record.id));
          }).catch(() => {});
        },
      },
    ]);
  }, []);

  useEffect(() => {
    (async () => {
      const defaults = await loadLastCookingDefaults();
      if (defaults) {
        setPeople(defaults.personCount);
        setMealType(defaults.mealType);
        if (defaults.caloriePreference !== undefined) {
          setCalorieTarget(defaults.caloriePreference);
        }
        if (defaults.customPeople) setCustomPeople(defaults.customPeople);
        if (defaults.customMealType) setCustomMealType(defaults.customMealType);
        if (defaults.customCalorie) setCustomCalorie(defaults.customCalorie);
      }
    })();
  }, []);

  const checkInventory = useCallback((): InventoryCheckResult => {
    const count = invState.ingredients.length;
    return {
      isEmpty: count === 0,
      isLowInventory: count <= 3 && count > 0,
      ingredientCount: count,
    };
  }, [invState.ingredients]);

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

  const effectivePeople = people === -1 ? (customPeople || 2) : people;
  const effectiveMealType = mealType === 'custom' ? (customMealType || '自定义') : mealType;
  const effectiveCalorie = calorieTarget === -1 ? (customCalorie ?? undefined) : calorieTarget;

  const handleStreamDone = useCallback((result: any) => {
    clearStallTimer();

    const sessionId = generateId();

    startSession({
      personCount: effectivePeople,
      mealType: mealType as any,
      caloriePreference: effectiveCalorie,
      customRequirement: customRequest,
    }, sessionId);
    // 程序端从per-dish营养求和（不依赖AI输出的根级estimatedNutrition）
    const computedTotalNutrition = (result.dishes || []).reduce(
      (sum: any, d: any) => {
        if (d.estimatedNutrition) {
          sum.calories += d.estimatedNutrition.calories || 0;
          sum.protein += d.estimatedNutrition.protein || 0;
          sum.fat += d.estimatedNutrition.fat || 0;
          sum.carbs += d.estimatedNutrition.carbs || 0;
        }
        return sum;
      },
      { calories: 0, protein: 0, fat: 0, carbs: 0 },
    );
    setStage1Result({
      menuProposal: {
        dishes: result.dishes || [],
        estimatedNutrition: computedTotalNutrition,
        missingItems: (result.missingItems || []).map((item: any, idx: number) => ({
          id: `${item.type}-${item.name}-${item.forDish}-${idx}`,
          type: item.type,
          name: item.name,
          suggestedAmount: item.suggestedAmount,
          forDish: item.forDish,
          isPurchased: false,
        })),
        cookingOrderDescription: result.cookingOrderDescription || '',
        flavorDescription: result.flavorDescription || '',
        summary: result.summary || { description: '', cookingOrder: '', flavorNotes: '' },
      },
      requirementInput: {
        personCount: effectivePeople,
        mealType: mealType as any,
        caloriePreference: effectiveCalorie,
        customRequirement: customRequest,
      },
      reasoningContent: result.reasoningContent || '',
    });

    if (result.dishes) {
      const nutritionByDish: Record<string, NutritionalData> = {};
      for (const dish of result.dishes) {
        if (dish.estimatedNutrition) {
          nutritionByDish[dish.name] = {
            ...dish.estimatedNutrition,
            source: 'estimated',
          };
        }
      }
      if (Object.keys(nutritionByDish).length > 0) {
        setEstimatedNutrition(nutritionByDish, effectivePeople);
      }
    }

    saveLastCookingDefaults({
      personCount: effectivePeople,
      mealType,
      caloriePreference: effectiveCalorie,
      customPeople,
      customMealType,
      customCalorie,
    });

    // 自动保存到历史记录
    const dishNames = (result.dishes || []).map((d: any) => d.name).join('、') || '菜单';
    menuHistoryService.add({
      name: `${mealType === 'breakfast' ? '早餐' : mealType === 'lunch' ? '午餐' : mealType === 'dinner' ? '晚餐' : '菜单'}：${dishNames}`,
      menuProposal: {
        dishes: result.dishes || [],
        estimatedNutrition: computedTotalNutrition,
        missingItems: result.missingItems || [],
        cookingOrderDescription: result.cookingOrderDescription || '',
        flavorDescription: result.flavorDescription || '',
        summary: result.summary || { description: '', cookingOrder: '', flavorNotes: '' },
      },
      reasoningContent: result.reasoningContent || '',
      requirement: {
        personCount: effectivePeople,
        mealType,
        caloriePreference: effectiveCalorie,
        customRequirement: customRequest,
      },
    }).catch(() => {}); // 静默失败，不影响主流程

    // 自动保存做菜进度
    cookingProgressService.save({
      id: sessionId,
      status: 'menu',
      stages: {
        requirement: { personCount: effectivePeople, mealType: mealType as any, caloriePreference: effectiveCalorie, customRequirement: customRequest },
        menu: {
          menuProposal: {
            dishes: result.dishes || [],
            estimatedNutrition: computedTotalNutrition,
            missingItems: (result.missingItems || []).map((item: any, idx: number) => ({
              id: `${item.type}-${item.name}-${item.forDish}-${idx}`,
              type: item.type,
              name: item.name,
              suggestedAmount: item.suggestedAmount,
              forDish: item.forDish,
              isPurchased: false,
            })),
            cookingOrderDescription: result.cookingOrderDescription || '',
            flavorDescription: result.flavorDescription || '',
            summary: result.summary || { description: '', cookingOrder: '', flavorNotes: '' },
          },
          requirementInput: { personCount: people, mealType: mealType as any, caloriePreference: calorieTarget, customRequirement: customRequest },
          reasoningContent: result.reasoningContent || '',
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      completedStageIndex: -1,
    }, `${mealType === 'breakfast' ? '早餐' : mealType === 'lunch' ? '午餐' : mealType === 'dinner' ? '晚餐' : '菜单'}：${dishNames}`).catch(() => {});

    setScreenState('idle');
    router.push('/cooking/pager');
  }, [effectivePeople, mealType, effectiveCalorie, customRequest, customPeople, customMealType, customCalorie, startSession, setStage1Result, setEstimatedNutrition, saveLastCookingDefaults, clearStallTimer]);

  const submitToAI = useCallback(() => {
    setScreenState('loading');
    setThinkingText('');
    setIsStalled(false);
    pendingResultRef.current = null;

    const stream = callAIStage1Stream(
      invState.ingredients.map((i) => ({
        name: i.name,
        weight: i.weight,
        createDate: i.createDate,
      })),
      invState.seasonings.map((s) => ({
        name: s.name,
        status: s.status,
      })),
      {
        personCount: effectivePeople,
        mealType,
        caloriePreference: effectiveCalorie,
        customRequirement: customRequest,
      },
      settingsState.preferences.dietaryRestrictions,
      settingsState.preferences,
      {
        onReasoning: (text: string) => {
          setThinkingText((prev) => prev + text);
          resetStallTimer();
        },
        onContent: (_text: string) => {
          resetStallTimer();
        },
        onData: () => {
          resetStallTimer();
        },
        onDone: (result: any) => {
          pendingResultRef.current = result;
          clearStallTimer();
          handleStreamDone(result);
        },
        onError: (error: Error) => {
          clearStallTimer();
          setScreenState('error');
          Alert.alert('AI 菜单生成失败', error.message || '请检查网络和 API 配置后重试。', [
            { text: '取消', onPress: () => setScreenState('idle') },
            { text: '重试', onPress: () => submitToAI() },
          ]);
        },
      },
    );

    streamRef.current = stream;
    // 启动首个卡顿检测
    resetStallTimer();
  }, [effectivePeople, mealType, effectiveCalorie, customRequest, invState, settingsState, resetStallTimer, clearStallTimer, handleStreamDone]);

  const handleRetry = useCallback(() => {
    // 取消当前请求
    if (streamRef.current) {
      streamRef.current.abort();
      streamRef.current = null;
    }
    clearStallTimer();
    // 重新发起
    submitToAI();
  }, [submitToAI, clearStallTimer]);

  const handleSubmit = useCallback(async () => {
    const check = checkInventory();

    if (check.isEmpty) {
      Alert.alert('库存暂无食材', '请先添加食材后再开始做菜。', [
        { text: '取消', style: 'cancel' },
        { text: '去添加食材', onPress: () => router.replace('/(tabs)') },
      ]);
      return;
    }

    if (check.isLowInventory) {
      Alert.alert(
        '库存紧张',
        `当前仅有 ${check.ingredientCount} 种食材，AI 将尽力搭配。建议添加更多食材以获得更好的菜单。`,
        [
          { text: '去添加食材', onPress: () => router.replace('/(tabs)') },
          { text: '继续', onPress: () => submitToAI() },
        ],
      );
      return;
    }

    submitToAI();
  }, [checkInventory, submitToAI]);

  // 自定义输入弹窗确认
  const handleCustomConfirm = useCallback(() => {
    if (!customModal) return;
    const val = customInputText.trim();
    switch (customModal.type) {
      case 'people': {
        const num = parseInt(val, 10);
        if (!val || isNaN(num) || num <= 0) {
          Alert.alert('输入错误', '请输入有效的正整数');
          return;
        }
        setCustomPeople(num);
        setPeople(-1);
        break;
      }
      case 'meal': {
        if (!val) {
          Alert.alert('输入错误', '请输入餐类描述');
          return;
        }
        setCustomMealType(val);
        setMealType('custom');
        break;
      }
      case 'calorie': {
        const num = parseInt(val, 10);
        if (!val || isNaN(num) || num <= 0) {
          Alert.alert('输入错误', '请输入有效的卡路里数');
          return;
        }
        setCustomCalorie(num);
        setCalorieTarget(-1);
        break;
      }
    }
    setCustomModal(null);
    setCustomInputText('');
  }, [customModal, customInputText]);

  // 自定义按钮点击
  const handleCustomPress = useCallback((type: 'people' | 'meal' | 'calorie') => {
    let currentValue = '';
    switch (type) {
      case 'people': currentValue = customPeople !== null ? String(customPeople) : ''; break;
      case 'meal': currentValue = customMealType; break;
      case 'calorie': currentValue = customCalorie !== null ? String(customCalorie) : ''; break;
    }
    setCustomInputText(currentValue);
    setCustomModal({ visible: true, type });
  }, [customPeople, customMealType, customCalorie]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>今天吃什么？</Text>
        <Text style={styles.subtitle}>告诉 AI 你的需求，让它为你搭配菜单</Text>

        <Text style={styles.sectionTitle}>用餐人数</Text>
        <View style={styles.chipRow}>
          {PEOPLE_OPTIONS.map((opt) => (
            <SelectableChip
              key={String(opt.value)}
              label={opt.value === -1 && customPeople ? `${customPeople}人` : opt.label}
              selected={opt.value === -1 ? people === -1 : people === opt.value}
              onPress={() => {
                if (opt.value === -1) {
                  handleCustomPress('people');
                } else {
                  setPeople(opt.value as number);
                  setCustomPeople(null);
                }
              }}
            />
          ))}
        </View>

        <Text style={styles.sectionTitle}>餐类</Text>
        <View style={styles.chipRow}>
          {MEAL_TYPE_OPTIONS.map((opt) => (
            <SelectableChip
              key={opt.value}
              label={opt.value === 'custom' && customMealType ? customMealType : opt.label}
              selected={opt.value === 'custom' ? mealType === 'custom' : mealType === opt.value}
              onPress={() => {
                if (opt.value === 'custom') {
                  handleCustomPress('meal');
                } else {
                  setMealType(opt.value as string);
                  setCustomMealType('');
                }
              }}
            />
          ))}
        </View>

        <Text style={styles.sectionTitle}>热量偏好</Text>
        <View style={styles.chipRow}>
          {CALORIE_OPTIONS.map((opt) => (
            <SelectableChip
              key={String(opt.value)}
              label={opt.value === -1 && customCalorie ? `${customCalorie}卡` : opt.label}
              selected={opt.value === -1 ? calorieTarget === -1 : calorieTarget === opt.value}
              onPress={() => {
                if (opt.value === -1) {
                  handleCustomPress('calorie');
                } else {
                  setCalorieTarget(opt.value);
                  setCustomCalorie(null);
                }
              }}
            />
          ))}
        </View>

        <Text style={styles.sectionTitle}>个性需求（可选）</Text>
        <TextInput
          style={styles.customInput}
          placeholder="如：想吃辣的、清淡一点、不要猪肉、30分钟内"
          placeholderTextColor={COLORS.textTertiary}
          value={customRequest}
          onChangeText={setCustomRequest}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          accessibilityLabel="个性需求输入框"
        />

        {/* 历史记录 */}
        <Text style={styles.sectionTitle}>历史记录</Text>
        {progressRecords.length === 0 ? (
          <Text style={styles.emptyRecords}>暂无进行中的菜单</Text>
        ) : (
          progressRecords.map((record) => (
            <View key={record.id} style={styles.recordCard}>
              <View style={styles.recordInfo}>
                <Text style={styles.recordName} numberOfLines={1}>{record.name}</Text>
                <View style={styles.recordMeta}>
                  <Text style={styles.recordStage}>{STAGE_LABELS[record.currentStage] || record.currentStage}</Text>
                  <Text style={styles.recordDate}>
                    {new Date(record.updatedAt).toLocaleDateString('zh-CN')}
                  </Text>
                </View>
              </View>
              <View style={styles.recordActions}>
                {record.session.completedStageIndex >= 4 ? (
                  <TouchableOpacity
                    style={styles.viewRecordBtn}
                    onPress={() => handleViewRecord(record)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.viewRecordBtnText}>查看</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.resumeBtn}
                    onPress={() => handleResume(record)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.resumeBtnText}>继续</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.deleteRecordBtn}
                  onPress={() => handleDeleteRecord(record)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.deleteRecordBtnText}>删除</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.bottomBar}>
        <Button
          title={screenState === 'loading' ? '生成中...' : 'AI 帮我定菜单'}
          variant="primary"
          size="lg"
          fullWidth
          loading={screenState === 'loading'}
          onPress={handleSubmit}
        />
      </View>

      <LoadingOverlay
        visible={screenState === 'loading'}
        thinkingText={thinkingText}
        isStalled={isStalled}
        onRetry={handleRetry}
      />

      {/* 自定义输入弹窗 */}
      <Modal
        visible={customModal?.visible ?? false}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomModal(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setCustomModal(null)}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {customModal?.type === 'people' ? '自定义用餐人数' : customModal?.type === 'meal' ? '自定义餐类' : '自定义热量'}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder={
                customModal?.type === 'people' ? '请输入人数' :
                customModal?.type === 'meal' ? '请输入餐类（如：下午茶）' :
                '请输入卡路里数'
              }
              placeholderTextColor={COLORS.textTertiary}
              value={customInputText}
              onChangeText={setCustomInputText}
              keyboardType={customModal?.type === 'meal' ? 'default' : 'numeric'}
              autoFocus
              onSubmitEditing={handleCustomConfirm}
            />
            <View style={styles.modalButtons}>
              <Button title="取消" variant="ghost" onPress={() => { setCustomModal(null); setCustomInputText(''); }} />
              <Button title="确认" variant="primary" onPress={handleCustomConfirm} />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: SPACING.lg, paddingTop: 60, paddingBottom: SPACING.xxl },
  title: { fontSize: TYPOGRAPHY.h1, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.xs },
  subtitle: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, marginBottom: SPACING.xxl },
  sectionTitle: { fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.md, marginTop: SPACING.lg },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  customInput: { backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary, minHeight: 100, ...SHADOWS.sm },
  bottomBar: { padding: SPACING.lg, paddingBottom: SPACING.xl, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  // 进度记录
  emptyRecords: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textTertiary, textAlign: 'center', paddingVertical: SPACING.xl },
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  recordInfo: { flex: 1, marginRight: SPACING.sm },
  recordName: { fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary },
  recordMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: SPACING.sm },
  recordStage: { fontSize: 11, color: COLORS.primary, backgroundColor: '#FFF0E6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  recordDate: { fontSize: 11, color: COLORS.textTertiary },
  recordActions: { flexDirection: 'row', gap: SPACING.xs },
  viewRecordBtn: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  viewRecordBtnText: { fontSize: 13, color: COLORS.primary, fontWeight: '500' },
  resumeBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  resumeBtnText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  deleteRecordBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  deleteRecordBtnText: { fontSize: 13, color: COLORS.textTertiary },
  // 自定义弹窗
  modalOverlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'center', padding: SPACING.xxl },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, padding: SPACING.xxl },
  modalTitle: { fontSize: TYPOGRAPHY.h3, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.lg },
  modalInput: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, height: 44, paddingHorizontal: SPACING.md, fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary, marginBottom: SPACING.lg },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.md },
});
