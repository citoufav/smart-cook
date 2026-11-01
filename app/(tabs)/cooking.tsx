import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Modal,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
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
import { useCustomAlert } from '../../src/components/CustomAlert';
import { useSettingsDrawer } from '../../src/contexts/SettingsDrawerContext';
import HeaderBar from '../../src/components/HeaderBar';
import { InventoryProfileChip, InventoryProfileSheet } from '../../src/components/InventoryProfileSheet';
import { NutritionalData, InventoryCheckResult, SavedDish } from '../../src/types';
import { callAIStage1Stream } from '../../src/services/aiService';
import { prepareReusedDishes, applyEdits } from '../../src/services/menuEditService';
import { logger } from '../../src/utils/logger';
import { useKeyboardHeight } from '../../src/hooks/useKeyboardHeight';
import { DishPickerSheet } from '../../src/components/DishSheets';
import { getRecentMeals } from '../../src/services/dietMemoryService';
import { cookingProgressService, CookingProgressRecord, STAGE_LABELS } from '../../src/services/cookingProgressService';
import { SSEStreamController } from '../../src/utils/sseStream';
import { generateId } from '../../src/utils/uuid';

// Reasoning-loop detection: a chunk (5-80 chars) repeated 5 times in a row means an infinite loop
const LOOP_REPEAT_COUNT = 5;
const LOOP_MIN_LEN = 5;
const LOOP_MAX_LEN = 80;
const LOOP_WINDOW = 600; // Detection window: last 600 chars

const log = logger('SCREEN:COOKING');

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
  const [isLooping, setIsLooping] = useState(false);
  const [activeRecords, setActiveRecords] = useState<CookingProgressRecord[]>([]);
  const [completedRecords, setCompletedRecords] = useState<CookingProgressRecord[]>([]);
  // 从我的菜里勾的旧菜：原样沿用，AI 只决定每道做多少、还缺什么
  const [reuseSelected, setReuseSelected] = useState<SavedDish[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  // Modal 是独立窗口，系统不会帮它让开键盘，只能自己量了往上抬
  const keyboardHeight = useKeyboardHeight();
  const [recentMeals, setRecentMeals] = useState<string[]>([]);
  const { showAlert } = useCustomAlert();
  const { openSettings } = useSettingsDrawer();

  const streamRef = useRef<SSEStreamController | null>(null);
  const pendingResultRef = useRef<any>(null);
  const reasoningBufRef = useRef('');
  const loopAbortedRef = useRef(false);
  const lastThinkingUpdateRef = useRef(0); // 思考文本 UI 节流
  const submitToAIRef = useRef<() => void>(() => {}); // 供 submitToAI 内部重试自引用
  // 已从存储恢复上次默认值后才允许自动保存（避免挂载时用初始值覆盖已保存配置）
  const defaultsLoadedRef = useRef(false);
  // 用户是否停留在本页（流式完成时不把其他页面的用户强行拉回）
  const isScreenFocusedRef = useRef(true);
  const isFocused = useIsFocused();
  isScreenFocusedRef.current = isFocused;

  // 卸载时中止进行中的 AI 请求，避免资源泄漏与迟到回调
  useEffect(() => {
    return () => {
      streamRef.current?.abort();
      streamRef.current = null;
    };
  }, []);

  const { state: invState } = useInventory();
  const { startSession, setStage1Result, restoreSession } = useCooking();
  const { state: settingsState, saveLastCookingDefaults, loadLastCookingDefaults } = useSettings();
  const { setEstimatedNutrition } = useNutrition();
  const { hideBall } = useNutrition();

  // 派生值：自定义选项的生效值（提前声明，供下方 effects 与回调使用）
  const effectivePeople = people === -1 ? (customPeople || 2) : people;
  const effectiveCalorie = calorieTarget === -1 ? (customCalorie ?? undefined) : calorieTarget;

  // Hide the floating ball each time the cooking tab is focused (user may have just returned from the recipe flow)
  useFocusEffect(
    useCallback(() => {
      hideBall();
      // Load in-progress cooking records (excluding completed)
      cookingProgressService.getActiveRecords().then(setActiveRecords).catch(() => {});
      // Load completed records
      cookingProgressService.getAllRecords().then((all) => {
        setCompletedRecords(all.filter((r) => r.isCompleted));
      }).catch(() => {});
      // Load diet memory
      getRecentMeals(3).then(setRecentMeals).catch(() => {});
    }, [hideBall]),
  );

  // Continue cooking (resume the in-progress session)
  const handleContinueRecord = useCallback((record: CookingProgressRecord) => {
    restoreSession(record.session);
    setTimeout(() => {
      router.push('/cooking/pager');
    }, 50);
  }, [restoreSession]);

  // View a completed record (read-only mode)
  const handleViewRecord = useCallback((record: CookingProgressRecord) => {
    restoreSession(record.session);
    setTimeout(() => {
      router.push('/cooking/pager?historyMode=1' as any);
    }, 50);
  }, [restoreSession]);

  // Delete a progress record
  const handleDeleteRecord = useCallback((record: CookingProgressRecord) => {
    showAlert({ title: '删除记录', message: `确定删除「${record.name}」吗？`, buttons: [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          cookingProgressService.remove(record.id).then(() => {
            setActiveRecords((prev) => prev.filter((r) => r.id !== record.id));
            setCompletedRecords((prev) => prev.filter((r) => r.id !== record.id));
          }).catch(() => {});
        },
      },
    ] });
  }, [showAlert]);

  useEffect(() => {
    (async () => {
      const defaults = await loadLastCookingDefaults();
      if (defaults) {
        // People: prefer the selector value (supports -1=custom)
        setPeople(defaults.people ?? defaults.personCount ?? 2);
        setMealType(defaults.mealType);
        // Calories: prefer the selector value (supports -1=custom)
        if (defaults.calorieTarget !== undefined) {
          setCalorieTarget(defaults.calorieTarget);
        } else if (defaults.caloriePreference !== undefined) {
          setCalorieTarget(defaults.caloriePreference);
        }
        if (defaults.customPeople) setCustomPeople(defaults.customPeople);
        if (defaults.customMealType) setCustomMealType(defaults.customMealType);
        if (defaults.customCalorie) setCustomCalorie(defaults.customCalorie);
      }
      // 无论是否读到默认值，恢复完成后再开启自动保存
      defaultsLoadedRef.current = true;
    })();
  }, []);

  // Auto-save: persist whenever people/meal type/calories change
  useEffect(() => {
    if (!defaultsLoadedRef.current) return; // 挂载初期不覆盖已保存的配置
    saveLastCookingDefaults({
      people,           // Preset selector value (-1=custom, 1-9=preset people)
      personCount: effectivePeople,
      mealType,
      calorieTarget,    // Calorie selector value (-1=custom)
      caloriePreference: effectiveCalorie,
      customPeople,
      customMealType,
      customCalorie,
    });
  }, [people, mealType, calorieTarget, customPeople, customMealType, customCalorie]);

  const checkInventory = useCallback((): InventoryCheckResult => {
    const count = invState.ingredients.length;
    return {
      isEmpty: count === 0,
      isLowInventory: count <= 3 && count > 0,
      ingredientCount: count,
    };
  }, [invState.ingredients]);

  /**
   * Detect whether the reasoning chain is stuck in an infinite loop
   * Within the latest LOOP_WINDOW chars, find a fragment repeated LOOP_REPEAT_COUNT times consecutively
   * @returns the detected repeated fragment, or null if no loop
   */
  const detectLoop = useCallback((reasoningText: string): string | null => {
    const buf = reasoningText.slice(-LOOP_WINDOW);
    if (buf.length < LOOP_MIN_LEN * LOOP_REPEAT_COUNT) return null;
    // Regex: capture any LOOP_MIN_LEN-LOOP_MAX_LEN chars and check for LOOP_REPEAT_COUNT consecutive repeats
    const re = new RegExp(`(.{${LOOP_MIN_LEN},${LOOP_MAX_LEN}}?)\\1{${LOOP_REPEAT_COUNT - 1},}`, 's');
    const m = buf.match(re);
    return m ? m[1] : null;
  }, []);

  const handleStreamDone = useCallback(async (result: any) => {
    const sessionId = generateId();

    // Build the requirement and menu proposal once, reused in 3 places (Stage1 state / menu history / cooking progress)
    const requirementInput = {
      personCount: effectivePeople,
      mealType: mealType as any,
      caloriePreference: effectiveCalorie,
      customRequirement: customRequest,
    };

    // 复用的旧菜 + AI 现补的菜 = 这一桌。
    // 旧菜按 AI 给的倍数缩放（没给就按人数比兜底），库存标记按当前库存重刷；
    // 采购清单和总热量交给 applyEdits 重算，因为它俩都得基于最终克数。
    const reusedDishes = reuseSelected.length > 0
      ? prepareReusedDishes(
          reuseSelected,
          result.reused ?? [],
          effectivePeople,
          {
            ingredients: invState.ingredients.map((i) => i.name),
            seasonings: invState.seasonings.map((s) => s.name),
          },
        )
      : [];
    const reusedNames = new Set(reusedDishes.map((d) => d.name.trim()));
    const aiDishes: any[] = result.dishes || [];
    const freshDishes = aiDishes.filter((d) => d?.name && !reusedNames.has(String(d.name).trim()));
    if (freshDishes.length < aiDishes.length) {
      log.info('AI 补的菜里有和已选旧菜重名的，已丢弃', { dropped: aiDishes.length - freshDishes.length });    }

    const menuProposal = applyEdits(
      {
        dishes: reusedDishes,
        estimatedNutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
        missingItems: [],
        cookingOrderDescription: result.cookingOrderDescription || '',
        flavorDescription: result.flavorDescription || '',
        summary: result.summary || { description: '', cookingOrder: '', flavorNotes: '' },
      },
      requirementInput,
      freshDishes.map((d) => ({ op: 'add_dish' as const, generated: d })),
    );

    if (menuProposal.dishes.length === 0) {
      setScreenState('error');
      showAlert({ title: '没有生成出菜单', message: 'AI 没给出可用的菜，请重试。', buttons: [
        { text: '知道了', onPress: () => setScreenState('idle') },
      ] });
      return;
    }
    const reasoningContent = result.reasoningContent || '';

    startSession(requirementInput, sessionId);
    setStage1Result({ menuProposal, requirementInput, reasoningContent });

    const nutritionByDish: Record<string, NutritionalData> = {};
    for (const dish of menuProposal.dishes) {
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

    saveLastCookingDefaults({
      people,
      personCount: effectivePeople,
      mealType,
      calorieTarget,
      caloriePreference: effectiveCalorie,
      customPeople,
      customMealType,
      customCalorie,
    });

    // 只落一份（cookingProgressService）：菜单历史以前还有一份独立副本，
    // 两份之间不会同步，编辑菜谱后历史页显示的是旧版本，所以副本已删。
    const dishNames = menuProposal.dishes.map((d) => d.name).join('、') || '菜单';
    const sessionName = `${mealType === 'breakfast' ? '早餐' : mealType === 'lunch' ? '午餐' : mealType === 'dinner' ? '晚餐' : '菜单'}：${dishNames}`;

    const progressRecord = await cookingProgressService.save({
      id: sessionId,
      status: 'menu',
      stages: {
        requirement: requirementInput,
        menu: { menuProposal, requirementInput, reasoningContent },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    }, sessionName);

    if (progressRecord === null) {
      showAlert({
        title: '菜单没能保存',
        message: '菜谱已生成，但写入本地存储失败（可能是空间不足）。切走这个页面后可能找不回来，建议先按备菜做，或稍后清一下存储再重新生成。',
        buttons: [{ text: '知道了' }],
      });
    }

    // 饮食记忆改为在「完成做菜」时记录（见 CompletionSheet / inventory-update），
    // 避免仅生成菜单就污染最近吃过列表

    setScreenState('idle');
    // 用户已切到其他页面（如切 Tab）时不强行拉回，结果已保存，可稍后从"进行中的菜单"进入
    if (isScreenFocusedRef.current) {
      router.push('/cooking/pager');
    }
  }, [effectivePeople, mealType, effectiveCalorie, customRequest, customPeople, customMealType, customCalorie, startSession, setStage1Result, setEstimatedNutrition, saveLastCookingDefaults, showAlert, reuseSelected, invState]);

  const submitToAI = useCallback(() => {
    setScreenState('loading');
    setThinkingText('');
    setIsLooping(false);
    reasoningBufRef.current = '';
    loopAbortedRef.current = false;
    lastThinkingUpdateRef.current = 0;
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
      recentMeals,
      {
        onReasoning: (text: string) => {
          reasoningBufRef.current += text;
          // 节流：思考文本 120ms 刷新一次，避免每个 SSE chunk 都触发整页重渲染
          const now = Date.now();
          if (now - lastThinkingUpdateRef.current >= 120) {
            lastThinkingUpdateRef.current = now;
            setThinkingText(reasoningBufRef.current);
          }
          const loopFragment = detectLoop(reasoningBufRef.current);
          if (loopFragment) {
            loopAbortedRef.current = true;
            setIsLooping(true);
            streamRef.current?.abort();
          }
        },
        onContent: (_text: string) => {
          // content arriving means AI is streaming JSON normally, no special handling needed
        },
        onData: () => {
          // Lower layer receives raw data, kept for compatibility
        },
        onDone: (result: any) => {
          if (loopAbortedRef.current) {
            return; // Abort already triggered by onReasoning, do not handle again
          }
          pendingResultRef.current = result;
          handleStreamDone(result);
        },
        onError: (error: Error) => {
          if (loopAbortedRef.current) {
            // Abort caused by an infinite loop; show a dedicated message
            setScreenState('error');
            showAlert({ title: '思考过程异常', message: 'AI 陷入重复思考，请重试或关闭思考模式。', buttons: [
              { text: '取消', onPress: () => setScreenState('idle') },
              { text: '重试', onPress: () => submitToAIRef.current() },
            ] });
            return;
          }
          setScreenState('error');
          showAlert({ title: 'AI 菜单生成失败', message: error.message || '请检查网络和 API 配置后重试。', buttons: [
            { text: '取消', onPress: () => setScreenState('idle') },
            { text: '重试', onPress: () => submitToAIRef.current() },
          ] });
        },
      },
      reuseSelected,
    );

    streamRef.current = stream;
    // Start the first stall detection
  }, [effectivePeople, mealType, effectiveCalorie, customRequest, invState, settingsState, recentMeals, handleStreamDone, showAlert, reuseSelected]);
  // 渲染期同步最新引用，供 submitToAI 内部"重试"按钮自引用
  submitToAIRef.current = submitToAI;

  const handleRetry = useCallback(() => {
    // Cancel the current request
    if (streamRef.current) {
      streamRef.current.abort();
      streamRef.current = null;
    }
    // Re-submit
    submitToAI();
  }, [submitToAI]);

  const handleSubmit = useCallback(async () => {
    const check = checkInventory();

    if (check.isEmpty) {
      showAlert({ title: '库存暂无食材', message: '请先添加食材后再开始做菜。', buttons: [
        { text: '取消', style: 'cancel' },
        { text: '去添加食材', onPress: () => router.replace('/(tabs)') },
      ] });
      return;
    }

    if (check.isLowInventory) {
      showAlert({
        title: '库存紧张',
        message: `当前仅有 ${check.ingredientCount} 种食材，AI 将尽力搭配。建议添加更多食材以获得更好的菜单。`,
        buttons: [
          { text: '去添加食材', onPress: () => router.replace('/(tabs)') },
          { text: '继续', onPress: () => submitToAI() },
        ],
      });
      return;
    }

    submitToAI();
  }, [checkInventory, submitToAI]);

  // Custom input modal confirm
  const handleCustomConfirm = useCallback(() => {
    if (!customModal) return;
    const val = customInputText.trim();
    switch (customModal.type) {
      case 'people': {
        const num = parseInt(val, 10);
        if (!val || isNaN(num) || num <= 0) {
          showAlert({ title: '输入错误', message: '请输入有效的正整数' });
          return;
        }
        setCustomPeople(num);
        setPeople(-1);
        break;
      }
      case 'meal': {
        if (!val) {
          showAlert({ title: '输入错误', message: '请输入餐类描述' });
          return;
        }
        setCustomMealType(val);
        setMealType('custom');
        break;
      }
      case 'calorie': {
        const num = parseInt(val, 10);
        if (!val || isNaN(num) || num <= 0) {
          showAlert({ title: '输入错误', message: '请输入有效的卡路里数' });
          return;
        }
        setCustomCalorie(num);
        setCalorieTarget(-1);
        break;
      }
    }
    setCustomModal(null);
    setCustomInputText('');
  }, [customModal, customInputText, showAlert]);

  // Custom button press
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
      <HeaderBar
        title="随煮"
        onOpenDrawer={openSettings}
        right={<InventoryProfileChip onPress={() => setProfileSheetOpen(true)} />}
      />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>今天吃什么？</Text>
        <Text style={styles.subtitle}>告诉 AI 你的需求，让它为你搭配菜单</Text>

        {recentMeals.length > 0 && (
          <View style={styles.recentMealsRow}>
            <Text style={styles.recentMealsLabel}>最近吃过：</Text>
            <Text style={styles.recentMealsText}>{recentMeals.join('、')}</Text>
          </View>
        )}

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

        <Text style={styles.sectionTitle}>复用做过的菜（可选）</Text>
        <TouchableOpacity
          style={styles.reusePickBtn}
          onPress={() => setPickerVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.reusePickText}>
            {reuseSelected.length > 0 ? `已选 ${reuseSelected.length} 道 · 再挑几道` : '从我的菜里挑'}
          </Text>
          <Text style={styles.reusePickArrow}>›</Text>
        </TouchableOpacity>
        {reuseSelected.length > 0 && (
          <View style={styles.reuseChips}>
            {reuseSelected.map((dish) => (
              <TouchableOpacity
                key={dish.id}
                style={styles.reuseChip}
                onPress={() => setReuseSelected(reuseSelected.filter((d) => d.id !== dish.id))}
                accessibilityLabel={`取消选择 ${dish.name}`}
              >
                <Text style={styles.reuseChipText}>{dish.name}</Text>
                <Text style={styles.reuseChipX}>×</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {reuseSelected.length > 0 && (
          <Text style={styles.reuseHint}>勾中的菜照旧做，AI 只决定每道做多少、还缺什么；主食每次重新配</Text>
        )}

        {/* History — in progress */}
        <Text style={styles.sectionTitle}>进行中的菜单</Text>
        {activeRecords.length === 0 ? (
          <Text style={styles.emptyRecords}>暂无进行中的菜单</Text>
        ) : (
          activeRecords.map((record) => (
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
                <TouchableOpacity
                  style={styles.continueRecordBtn}
                  onPress={() => handleContinueRecord(record)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.continueRecordBtnText}>继续</Text>
                </TouchableOpacity>
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

        {/* History — completed */}
        {completedRecords.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: SPACING.lg }]}>已完成的菜单</Text>
            {completedRecords.map((record) => (
              <View key={record.id} style={[styles.recordCard, styles.recordCardCompleted]}>
                <View style={styles.recordInfo}>
                  <Text style={styles.recordName} numberOfLines={1}>{record.name}</Text>
                  <View style={styles.recordMeta}>
                    <Text style={styles.recordStageCompleted}>已完成</Text>
                    <Text style={styles.recordDate}>
                      {new Date(record.updatedAt).toLocaleDateString('zh-CN')}
                    </Text>
                  </View>
                </View>
                <View style={styles.recordActions}>
                  <TouchableOpacity
                    style={styles.viewRecordBtn}
                    onPress={() => handleViewRecord(record)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.viewRecordBtnText}>查看</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteRecordBtn}
                    onPress={() => handleDeleteRecord(record)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.deleteRecordBtnText}>删除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
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
        isLooping={isLooping}
        onRetry={handleRetry}
        showThinking={settingsState.preferences.thinkingEnabled}
      />

      <DishPickerSheet
        visible={pickerVisible}
        selected={reuseSelected}
        onChange={setReuseSelected}
        onClose={() => setPickerVisible(false)}
      />

      <InventoryProfileSheet visible={profileSheetOpen} onClose={() => setProfileSheetOpen(false)} />

      {/* Custom input modal */}
      <Modal
        visible={customModal?.visible ?? false}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomModal(null)}
      >
        <TouchableOpacity
          style={[styles.modalOverlay, { paddingBottom: SPACING.xxl + keyboardHeight }]}
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
  scrollContent: { padding: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  title: { fontSize: TYPOGRAPHY.h1, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.xs },
  subtitle: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, marginBottom: SPACING.xs },
  recentMealsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3E0', borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, marginBottom: SPACING.lg },
  recentMealsLabel: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary },
  recentMealsText: { fontSize: TYPOGRAPHY.caption, color: COLORS.primary, fontWeight: '500', flex: 1 },
  sectionTitle: { fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.md, marginTop: SPACING.lg },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  customInput: { backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary, minHeight: 100, ...SHADOWS.sm },
  bottomBar: { padding: SPACING.lg, paddingBottom: SPACING.xl, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  // Progress records
  emptyRecords: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textTertiary, textAlign: 'center', paddingVertical: SPACING.xl },
  // 复用做过的菜
  reusePickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
  },
  reusePickText: { fontSize: TYPOGRAPHY.body, color: COLORS.textBody },
  reusePickArrow: { fontSize: 20, color: COLORS.textTertiary, marginTop: -2 },
  reuseChips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  reuseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primaryBg,
    borderRadius: BORDER_RADIUS.full,
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
  },
  reuseChipText: { fontSize: TYPOGRAPHY.caption, color: COLORS.primaryDark, fontWeight: '600' },
  reuseChipX: { fontSize: 14, color: COLORS.primary, fontWeight: '700' },
  reuseHint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginTop: SPACING.xs, lineHeight: 17 },
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
  continueRecordBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  continueRecordBtnText: { fontSize: 13, color: COLORS.textWhite, fontWeight: '600' },
  // 用浅灰底代替 opacity：opacity 会连按钮一起调暗，看着像禁用，点了却还能用
  recordCardCompleted: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  recordStageCompleted: {
    fontSize: 11,
    color: '#2D9F4E',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  deleteRecordBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  deleteRecordBtnText: { fontSize: 13, color: COLORS.textSecondary },
  // Custom modal
  modalOverlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'center', padding: SPACING.xxl },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, padding: SPACING.xxl },
  modalTitle: { fontSize: TYPOGRAPHY.h3, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.lg },
  modalInput: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, height: 44, paddingHorizontal: SPACING.md, fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary, marginBottom: SPACING.lg },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.md },
});

