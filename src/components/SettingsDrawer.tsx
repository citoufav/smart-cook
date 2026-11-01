import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  Animated,
  Switch,
  useWindowDimensions,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../contexts/SettingsContext';
import { useInventory } from '../contexts/InventoryContext';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { Button } from './Button';
import { useCustomAlert } from './CustomAlert';
import { ApiType, CookingSkill, UserPreferences } from '../types';
import { validateApiKey } from '../utils/validation';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { backupService, describeImport } from '../services/backupService';
import { MAX_BACKUP_CHARS } from '../utils/backupFormat';
import { useKeyboardAwareScroll } from '../hooks/useKeyboardAwareScroll';
import { AI_PROVIDERS, findProvider, isDeepSeekType } from '../constants/aiProviders';
import { HEALTH_CONDITIONS } from '../constants/healthConditions';
import { TagChipGroup } from './TagChipGroup';

// 2026-10 官方模型列表：deepseek-v4-pro（旗舰，纯文本）与 deepseek-flash（快速，支持图片输入）。
// 旧的 deepseek-v4-flash / deepseek-v4-flash-vision-exp 仍被接受但已退役，请求实际由 V4.1-Flash 承接。
const COOKING_SKILL_OPTIONS: { label: string; value: CookingSkill; hint: string }[] = [
  { label: '新手', value: 'beginner', hint: '每一步都写清火候、温度、时长和判断标准' },
  { label: '家常', value: 'intermediate', hint: '火候和时长给范围，关键判断点写清楚' },
  { label: '熟练', value: 'experienced', hint: '只写操作顺序和配料，细节省略（用量仍写克重）' },
];

function pickCookingSkill(value: string): CookingSkill {
  return COOKING_SKILL_OPTIONS.some((o) => o.value === value) ? (value as CookingSkill) : 'beginner';
}

/** 抽屉里可折叠的分区。顺序 = 展示顺序 */
/** 顺序即抽屉里从上到下的顺序：口味在最前（最常改），数据管理垫底 */
const SECTION_KEYS = ['taste', 'diet', 'skill', 'ai', 'data'] as const;
const PICKABLE_SECTIONS = new Set<string>(SECTION_KEYS);

// ---- Dropdown selector ----
function DropdownSelector({
  label,
  options,
  selectedValue,
  onSelect,
}: {
  label: string;
  options: { label: string; value: string }[];
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const selectedLabel = options.find((o) => o.value === selectedValue)?.label || selectedValue;

  return (
    <View style={styles.dropdownWrapper}>
      <TouchableOpacity
        style={styles.dropdownButton}
        onPress={() => setVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.dropdownButtonText} numberOfLines={1}>{selectedLabel}</Text>
        <Text style={styles.dropdownArrow}>▼</Text>
      </TouchableOpacity>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{label}</Text>
            {options.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.modalOption,
                  opt.value === selectedValue && styles.modalOptionActive,
                ]}
                onPress={() => {
                  onSelect(opt.value);
                  setVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.modalOptionText,
                    opt.value === selectedValue && styles.modalOptionTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
                {opt.value === selectedValue && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}


interface SettingsDrawerProps {
  visible: boolean;
  onClose: () => void;
}

export default function SettingsDrawer({ visible, onClose }: SettingsDrawerProps) {
  const { state, updateApiKey, updatePreferences } = useSettings();
  const { refreshFromStorage, refreshProfiles } = useInventory();
  const { preferences } = state;
  const { showAlert } = useCustomAlert();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const panelWidth = screenWidth * 0.85;

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelName, setModelName] = useState(preferences.modelName);
  const [apiUrl, setApiUrl] = useState(preferences.apiUrl);
  // 键盘弹起时把输入框滚到键盘上方（edge-to-edge 下系统不会自己滚）
  const { scrollRef, onScroll, captureFocus, captureNode, keyboardHeight } = useKeyboardAwareScroll();
  const apiKeyRef = useRef<TextInput>(null);
  const apiUrlRef = useRef<TextInput>(null);
  const modelRef = useRef<TextInput>(null);
  const [apiType, setApiType] = useState<ApiType>(preferences.apiType);
  const [dietaryTags, setDietaryTags] = useState<string[]>([...preferences.dietaryRestrictions]);
  // 长期疾病默认收起：平时不占版面，也不把这排字摆在所有人面前
  const [showConditions, setShowConditions] = useState(false);
  const [healthTags, setHealthTags] = useState<string[]>([...(preferences.healthConditions ?? [])]);
  const [tasteTags, setTasteTags] = useState<string[]>([...preferences.tastePreferences]);
  const [cookingSkill, setCookingSkill] = useState<CookingSkill>(
    pickCookingSkill(preferences.cookingSkill),
  );
  // 默认全部展开（不藏东西），用户折叠后记住，下次打开保持原样
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(SECTION_KEYS));

  // Sync external state changes
  useEffect(() => {
    if (visible) {
      setModelName(preferences.modelName);
      setApiUrl(preferences.apiUrl);
      setApiType(preferences.apiType);
      setDietaryTags([...preferences.dietaryRestrictions]);
      setHealthTags([...(preferences.healthConditions ?? [])]);
      setTasteTags([...preferences.tastePreferences]);
      setCookingSkill(pickCookingSkill(preferences.cookingSkill));
    }
  }, [visible, preferences]);

  // 折叠状态独立存储：不能跟着 preferences 一起重置，否则内部自动保存一次就全弹开
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(STORAGE_KEYS.SETTINGS_DRAWER_SECTIONS)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) {
          setExpandedSections(new Set(saved.filter((k) => PICKABLE_SECTIONS.has(k))));
        }
      })
      .catch(() => {});
  }, [visible]);

  const toggleSection = useCallback((key: string) => {
    const next = new Set(expandedSections);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedSections(next);
    AsyncStorage.setItem(STORAGE_KEYS.SETTINGS_DRAWER_SECTIONS, JSON.stringify([...next])).catch(() => {});
  }, [expandedSections]);

  const slideAnim = useRef(new Animated.Value(-panelWidth)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -panelWidth,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, panelWidth, slideAnim]);

  const autoSave = useCallback(async (partial: Partial<UserPreferences>) => {
    await updatePreferences(partial);
  }, [updatePreferences]);

  const handleDietaryChange = useCallback(async (newTags: string[]) => {
    setDietaryTags(newTags);
    await updatePreferences({ dietaryRestrictions: newTags });
  }, [updatePreferences]);

  const handleHealthChange = useCallback(async (newTags: string[]) => {
    setHealthTags(newTags);
    await updatePreferences({ healthConditions: newTags });
  }, [updatePreferences]);

  const handleTasteChange = useCallback(async (newTags: string[]) => {
    setTasteTags(newTags);
    await updatePreferences({ tastePreferences: newTags });
  }, [updatePreferences]);

  const handleSaveApiKey = useCallback(async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      showAlert({ title: '未输入', message: '请输入 API Key 后再保存' });
      return;
    }
    const error = validateApiKey(trimmed);
    if (error) {
      showAlert({ title: 'API Key 格式有误', message: error });
      return;
    }
    await updateApiKey(trimmed);
    setApiKeyInput('');
    showAlert({ title: '已保存', message: 'API Key 已更新' });
  }, [apiKeyInput, updateApiKey, showAlert]);

  const handleExport = useCallback(async () => {
    try {
      const json = await backupService.exportAll();
      const fileName = `随煮备份_${new Date().toISOString().slice(0, 10)}.json`;
      const filePath = FileSystem.cacheDirectory + fileName;
      await FileSystem.writeAsStringAsync(filePath, json, { encoding: 'utf8' as any });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, { mimeType: 'application/json', dialogTitle: '导出备份' });
      } else {
        showAlert({ title: '提示', message: '当前设备不支持文件分享' });
      }
    } catch (e: any) {
      showAlert({ title: '导出失败', message: e?.message || '无法导出文件' });
    }
  }, [showAlert]);

  const handleImport = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      let content: string;
      if (Platform.OS === 'web') {
        // On web, expo-file-system native I/O is unavailable; read the file via browser fetch instead
        content = await fetch(file.uri).then((r) => r.text());
      } else {
        content = await FileSystem.readAsStringAsync(file.uri, { encoding: 'utf8' as any });
      }
      // 20MB 的 JSON 读进来再解析会把手机卡死，先按体积挡掉
      if (content.length > MAX_BACKUP_CHARS) {
        showAlert({ title: '文件太大', message: '超过 20MB，不像随煮的备份文件。' });
        return;
      }
      const summary = await backupService.importAll(content);
      await refreshProfiles();
      await refreshFromStorage();
      showAlert({ title: '导入完成', message: describeImport(summary) });
    } catch (e: any) {
      showAlert({ title: '导入失败', message: e?.message || '请选择随煮导出的 JSON 备份文件' });
    }
  }, [refreshProfiles, refreshFromStorage, showAlert]);

  const maskedKey = preferences.apiKey
    ? preferences.apiKey.length <= 8
      ? '****'
      : preferences.apiKey.slice(0, 4) + '****' + preferences.apiKey.slice(-4)
    : '未设置';

  if (!visible) return null;

  return (
    <View style={styles.overlayContainer}>
      <Animated.View
        style={[
          styles.panel,
          {
            width: panelWidth,
            paddingTop: insets.top + SPACING.md,
            transform: [{ translateX: slideAnim }],
          },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>设置</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scrollArea}
          onScroll={onScroll}
          scrollEventThrottle={16}
          // 键盘弹起时多留出底部空间：抽屉不是 Modal，系统不会帮它让位，
          // 多一截滚动余量至少能让输入框滚到键盘上方
          contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardHeight + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ---- Taste preferences（放最前：最常改的一项） ---- */}
          <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('taste')} activeOpacity={0.6}>
            <Text style={styles.sectionHeaderText}>口味与菜系</Text>
            <Text style={styles.chevron}>{expandedSections.has('taste') ? '▾' : '▸'}</Text>
          </TouchableOpacity>
          {expandedSections.has('taste') && (
            <>
              <TagChipGroup
                items={[]}
                selected={tasteTags}
                onChange={handleTasteChange}
                addPlaceholder="其他偏好，如：咖喱"
                onlySelected
                onInputFocus={captureNode}
              />
              <Text style={styles.itemCount}>
                {tasteTags.length > 0 ? `${tasteTags.length} 项，点一下取消` : '还没设置'}
              </Text>
            </>
          )}

          {/* ---- Dietary restrictions ---- */}
          <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('diet')} activeOpacity={0.6}>
            <Text style={styles.sectionHeaderText}>忌口设置</Text>
            <Text style={styles.chevron}>{expandedSections.has('diet') ? '▾' : '▸'}</Text>
          </TouchableOpacity>
          {expandedSections.has('diet') && (
            <>
              <TagChipGroup
                items={[]}
                selected={dietaryTags}
                onChange={handleDietaryChange}
                addPlaceholder="其他忌口，如：不吃苦瓜"
                onlySelected
                onInputFocus={captureNode}
              />
              <Text style={styles.itemCount}>
                {dietaryTags.length > 0 ? `${dietaryTags.length} 项，点一下取消` : '还没设置'}
              </Text>

              {/*
                长期疾病折起来：不是给所有人看的，摆在外面既长又忌讳。
                展开后点一下就往忌口里加一条写清楚的约束（存整句，见 healthConditions）。
              */}
              <TouchableOpacity
                style={styles.conditionToggle}
                onPress={() => setShowConditions(!showConditions)}
                activeOpacity={0.6}
              >
                <Text style={styles.conditionToggleText}>
                  {showConditions ? '▾' : '▸'} 有长期疾病或特殊饮食方式？
                </Text>
              </TouchableOpacity>
              {showConditions && (
                <>
                  <TagChipGroup
                    items={HEALTH_CONDITIONS.map((c) => c.label)}
                    selected={healthTags}
                    onChange={handleHealthChange}
                    addPlaceholder="其他情况，如：肾病"
                    onInputFocus={captureNode}
                  />
                  <Text style={styles.conditionNote}>
                    只是让 AI 避开相应的食材和做法，不能代替医生或营养师的建议。
                  </Text>
                </>
              )}
            </>
          )}

          {/* ---- Cooking skill ---- */}
          <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('skill')} activeOpacity={0.6}>
            <Text style={styles.sectionHeaderText}>烹饪熟练度</Text>
            <Text style={styles.chevron}>{expandedSections.has('skill') ? '▾' : '▸'}</Text>
          </TouchableOpacity>
          {expandedSections.has('skill') && (
            <>
              <View style={styles.chipRow}>
                {COOKING_SKILL_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.reasoningChip, cookingSkill === opt.value && styles.reasoningChipActive]}
                    onPress={() => { setCookingSkill(opt.value); autoSave({ cookingSkill: opt.value }); }}
                  >
                    <Text style={[styles.reasoningChipText, cookingSkill === opt.value && styles.reasoningChipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.hint}>
                {COOKING_SKILL_OPTIONS.find((o) => o.value === cookingSkill)?.hint}
              </Text>
            </>
          )}

          {/* ---- Model & API ---- */}
          <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('ai')} activeOpacity={0.6}>
            <Text style={styles.sectionHeaderText}>模型与 API</Text>
            <Text style={styles.chevron}>{expandedSections.has('ai') ? '▾' : '▸'}</Text>
          </TouchableOpacity>
          {expandedSections.has('ai') && (
            <>
              <DropdownSelector
                label="服务商"
                options={AI_PROVIDERS.map((p) => ({ label: p.label, value: p.id }))}
                selectedValue={apiType}
                onSelect={(val) => {
                  const preset = findProvider(val);
                  setApiType(val as ApiType);
                  // 预设只填一次：自定义/空值不覆盖用户已经填好的东西
                  const patch: Partial<UserPreferences> = { apiType: val as ApiType };
                  if (preset?.baseUrl) {
                    setApiUrl(preset.baseUrl);
                    patch.apiUrl = preset.baseUrl;
                  }
                  if (preset?.model) {
                    setModelName(preset.model);
                    patch.modelName = preset.model;
                  }
                  autoSave(patch);
                }}
              />
              {findProvider(apiType)?.hint ? (
                <Text style={styles.hint}>{findProvider(apiType)?.hint}</Text>
              ) : null}

              {/*
                DeepSeek 官方什么都不给选：没有模型、没有思考开关、连 API 地址都没有。
                用这个软件的人可能连电脑都没怎么用过，地址填错一个斜杠就调不通，
                而错误信息（404）对他们是天书。地址和模型在 aiClient 里写死。
                想自定义就去选「OpenAI 兼容」或「Anthropic 兼容」，那里字段齐全。
              */}

              {!isDeepSeekType(apiType) && (
                <>
                  <TextInput
                    ref={apiUrlRef}
                    style={styles.input}
                    placeholder="API 地址 (如 https://api.openai.com/v1)"
                    value={apiUrl}
                    onChangeText={setApiUrl}
                    placeholderTextColor={COLORS.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onFocus={captureFocus(apiUrlRef)}
                    onSubmitEditing={() => autoSave({ apiUrl })}
                    onBlur={() => { if (apiUrl.trim()) autoSave({ apiUrl: apiUrl.trim() }); }}
                  />
                  <TextInput
                    ref={modelRef}
                    style={styles.input}
                    placeholder="模型名称 (如 claude-sonnet-4-5)"
                    value={modelName}
                    onChangeText={setModelName}
                    placeholderTextColor={COLORS.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onFocus={captureFocus(modelRef)}
                    onSubmitEditing={() => autoSave({ modelName })}
                    onBlur={() => { if (modelName.trim()) autoSave({ modelName: modelName.trim() }); }}
                  />
                </>
              )}

              <Text style={styles.apiKeyLabel}>API Key: {maskedKey}</Text>
              <TextInput
                ref={apiKeyRef}
                style={styles.input}
                placeholder="输入新的 API Key (sk-...)"
                placeholderTextColor={COLORS.textTertiary}
                value={apiKeyInput}
                onChangeText={setApiKeyInput}
                secureTextEntry={!showApiKey}
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={captureFocus(apiKeyRef)}
              />
              <View style={styles.row}>
                <TouchableOpacity onPress={() => setShowApiKey(!showApiKey)}>
                  <Text style={styles.linkText}>{showApiKey ? '隐藏' : '显示'}</Text>
                </TouchableOpacity>
                <Button title="保存" variant="primary" size="sm" onPress={handleSaveApiKey} />
              </View>
            </>
          )}

          {/* ---- Data management ---- */}
          <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('data')} activeOpacity={0.6}>
            <Text style={styles.sectionHeaderText}>数据管理</Text>
            <Text style={styles.chevron}>{expandedSections.has('data') ? '▾' : '▸'}</Text>
          </TouchableOpacity>
          {expandedSections.has('data') && (
            <>
              <View style={styles.dataRow}>
                <TouchableOpacity style={styles.dataBtn} onPress={handleExport} activeOpacity={0.7}>
                  <Ionicons name="arrow-up-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.dataBtnText}>导出备份</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dataBtn} onPress={handleImport} activeOpacity={0.7}>
                  <Ionicons name="arrow-down-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.dataBtnText}>导入备份</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.dataHint}>
                一次性带走所有库存档案、我的菜和菜单记录。导入只增不改，不会覆盖你现有的东西；API Key 不会导出。
              </Text>

              {/* 调试用：反复检查首启流程。发布前应保持关闭 */}
              <View style={styles.switchRow}>
                <View style={styles.switchLabelWrap}>
                  <Text style={styles.switchLabel}>每次启动都显示引导</Text>
                  <Text style={styles.switchHint}>调试用。开启后下次打开会重新走一遍引导流程</Text>
                </View>
                <Switch
                  value={preferences.forceOnboarding === true}
                  onValueChange={(val) => autoSave({ forceOnboarding: val })}
                  trackColor={{ false: COLORS.border, true: COLORS.primary }}
                  thumbColor="#fff"
                />
              </View>
            </>
          )}
        </ScrollView>
      </Animated.View>
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    flexDirection: 'row',
  },
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
  },
  panel: {
    backgroundColor: COLORS.background,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: TYPOGRAPHY.h3,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  closeBtn: {
    fontSize: 22,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  scrollArea: { flex: 1 },
  scrollContent: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  sectionTitle: {
    fontSize: TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
    marginTop: SPACING.sm,
  },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    height: 44,
    paddingHorizontal: SPACING.md,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.surface,
  },
  apiKeyLabel: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  linkText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.primary },

  // Dropdown selector
  dropdownWrapper: { marginBottom: SPACING.md },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    height: 44,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
  },
  dropdownButtonText: { flex: 1, fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary },
  dropdownArrow: { fontSize: 12, color: COLORS.textTertiary, marginLeft: SPACING.sm },
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    padding: SPACING.xxl,
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
  },
  modalTitle: {
    fontSize: TYPOGRAPHY.h3,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.xs,
  },
  modalOptionActive: { backgroundColor: COLORS.primaryBg },
  modalOptionText: { fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary },
  modalOptionTextActive: { color: COLORS.primary, fontWeight: '600' },
  checkmark: { fontSize: 18, color: COLORS.primary, fontWeight: '700' },

  // Thinking mode
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  switchLabelWrap: { flex: 1, marginRight: SPACING.md },
  switchLabel: { fontSize: TYPOGRAPHY.body, fontWeight: '500', color: COLORS.textPrimary },
  switchHint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginTop: 2 },
  reasoningRow: { marginBottom: SPACING.md },
  chipRow: { flexDirection: 'row', gap: SPACING.sm },
  reasoningChip: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  reasoningChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryBg },
  reasoningChipText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  reasoningChipTextActive: { color: COLORS.primary, fontWeight: '600' },

  // Divider
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: SPACING.lg },

  // Collapsible section header
  // marginBottom 才是"分割线和下面的内容之间的空隙"：只加 padding 的话，
  // 线是 borderBottom，它下面紧贴着的还是下一行内容
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    marginBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionHeaderText: { fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary },
  chevron: { fontSize: 16, color: COLORS.textTertiary },

  // Hint
  hint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginBottom: SPACING.sm },
  itemCount: {
    fontSize: TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
    marginTop: SPACING.sm,
  },

  // 长期疾病/饮食方式
  conditionToggle: { paddingVertical: SPACING.sm, marginTop: SPACING.sm },
  conditionToggleText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  conditionNote: {
    fontSize: TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
    lineHeight: 17,
    marginTop: SPACING.sm,
  },

  // Dietary tags
  tagInputRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start' },
  tagInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    height: 44,
    paddingHorizontal: SPACING.md,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.surface,
  },
  tagList: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.md },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primaryBg,
    borderRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    gap: 6,
  },
  tagText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.primary, fontWeight: '500' },
  tagRemove: { fontSize: 18, color: COLORS.primary, fontWeight: '700', lineHeight: 20 },
  // Data management
  dataRow: { flexDirection: 'row', gap: SPACING.md },
  dataBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm },
  dataBtnText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.primary, fontWeight: '500' },
  dataHint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, lineHeight: 17, marginTop: SPACING.sm },
});
