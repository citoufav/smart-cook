import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  Switch,
  Animated,
  useWindowDimensions,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { ApiType, CookingSkill, ReasoningEffort, UserPreferences } from '../types';
import { validateApiKey } from '../utils/validation';

// 2026-10 官方模型列表：deepseek-v4-pro（旗舰，纯文本）与 deepseek-flash（快速，支持图片输入）。
// 旧的 deepseek-v4-flash / deepseek-v4-flash-vision-exp 仍被接受但已退役，请求实际由 V4.1-Flash 承接。
const DEEPSEEK_MODELS = [
  { label: 'deepseek-v4-pro（旗舰，纯文本）', value: 'deepseek-v4-pro' },
  { label: 'deepseek-flash（快速，支持图片）', value: 'deepseek-flash' },
];

const REASONING_OPTIONS: { label: string; value: ReasoningEffort }[] = [
  { label: '低', value: 'low' },
  { label: '高', value: 'high' },
  { label: '最大', value: 'max' },
];

/** 老数据可能存着已下线的档位，读回时回退到 high */
function pickReasoningEffort(value: string): ReasoningEffort {
  return REASONING_OPTIONS.some((o) => o.value === value) ? (value as ReasoningEffort) : 'high';
}

const COOKING_SKILL_OPTIONS: { label: string; value: CookingSkill; hint: string }[] = [
  { label: '新手', value: 'beginner', hint: '每一步都写清火候、温度、时长和判断标准' },
  { label: '家常', value: 'intermediate', hint: '火候和时长给范围，关键判断点写清楚' },
  { label: '熟练', value: 'experienced', hint: '只写操作顺序和配料，细节省略（用量仍写克重）' },
];

function pickCookingSkill(value: string): CookingSkill {
  return COOKING_SKILL_OPTIONS.some((o) => o.value === value) ? (value as CookingSkill) : 'beginner';
}

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

// ---- Dietary tag input ----
function DietaryTagInput({
  tags,
  onTagsChange,
  placeholder = '输入忌口项，如：不吃辣',
}: {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [inputValue, setInputValue] = useState('');

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onTagsChange([...tags, trimmed]);
      setInputValue('');
    }
  }, [inputValue, tags, onTagsChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onTagsChange(tags.filter((_, i) => i !== index));
    },
    [tags, onTagsChange],
  );

  return (
    <View>
      <View style={styles.tagInputRow}>
        <TextInput
          style={styles.tagInput}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textTertiary}
          value={inputValue}
          onChangeText={setInputValue}
          onSubmitEditing={handleAdd}
          returnKeyType="done"
        />
        <Button title="添加" variant="primary" size="sm" onPress={handleAdd} />
      </View>
      {tags.length > 0 && (
        <View style={styles.tagList}>
          {tags.map((tag, index) => (
            <View key={`${tag}-${index}`} style={styles.tagChip}>
              <Text style={styles.tagText}>{tag}</Text>
              <TouchableOpacity onPress={() => handleRemove(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.tagRemove}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

interface SettingsDrawerProps {
  visible: boolean;
  onClose: () => void;
}

export default function SettingsDrawer({ visible, onClose }: SettingsDrawerProps) {
  const { state, updateApiKey, updatePreferences } = useSettings();
  const { exportInventoryJson, importInventoryJson } = useInventory();
  const { preferences } = state;
  const { showAlert } = useCustomAlert();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const panelWidth = screenWidth * 0.85;

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelName, setModelName] = useState(preferences.modelName);
  const [apiUrl, setApiUrl] = useState(preferences.apiUrl);
  const [apiType, setApiType] = useState<ApiType>(preferences.apiType);
  const [thinkingEnabled, setThinkingEnabled] = useState(preferences.thinkingEnabled);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    pickReasoningEffort(preferences.reasoningEffort),
  );
  const [dietaryTags, setDietaryTags] = useState<string[]>([...preferences.dietaryRestrictions]);
  const [tasteTags, setTasteTags] = useState<string[]>([...preferences.tastePreferences]);
  const [cookingSkill, setCookingSkill] = useState<CookingSkill>(
    pickCookingSkill(preferences.cookingSkill),
  );
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['diet', 'skill', 'ai', 'data']));

  // Sync external state changes
  useEffect(() => {
    if (visible) {
      setModelName(preferences.modelName);
      setApiUrl(preferences.apiUrl);
      setApiType(preferences.apiType);
      setThinkingEnabled(preferences.thinkingEnabled);
      setReasoningEffort(pickReasoningEffort(preferences.reasoningEffort));
      setDietaryTags([...preferences.dietaryRestrictions]);
      setTasteTags([...preferences.tastePreferences]);
      setCookingSkill(pickCookingSkill(preferences.cookingSkill));
      setExpandedSections(new Set(['diet', 'skill', 'ai', 'data']));
    }
  }, [visible, preferences]);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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
    const json = exportInventoryJson();
    try {
      const fileName = `随煮_${new Date().toISOString().slice(0, 10)}.json`;
      const filePath = FileSystem.cacheDirectory + fileName;
      await FileSystem.writeAsStringAsync(filePath, json, { encoding: 'utf8' as any });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, { mimeType: 'application/json', dialogTitle: '导出库存' });
      } else {
        showAlert({ title: '提示', message: '当前设备不支持文件分享' });
      }
    } catch (e: any) {
      showAlert({ title: '导出失败', message: e?.message || '无法导出文件' });
    }
  }, [exportInventoryJson, showAlert]);

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
      await importInventoryJson(content);
      showAlert({ title: '导入成功', message: '库存数据已更新' });
    } catch (e: any) {
      showAlert({ title: '导入失败', message: e.message || '请选择有效的 JSON 文件' });
    }
  }, [importInventoryJson, showAlert]);

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
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ---- Dietary restrictions ---- */}
          <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('diet')} activeOpacity={0.6}>
            <Text style={styles.sectionHeaderText}>忌口设置</Text>
            <Text style={styles.chevron}>{expandedSections.has('diet') ? '▾' : '▸'}</Text>
          </TouchableOpacity>
          {expandedSections.has('diet') && (
            <>
              <DietaryTagInput tags={dietaryTags} onTagsChange={handleDietaryChange} />
              <Text style={styles.itemCount}>{dietaryTags.length} 项</Text>
            </>
          )}

          {/* ---- Taste preferences ---- */}
          <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection('taste')} activeOpacity={0.6}>
            <Text style={styles.sectionHeaderText}>口味与菜系</Text>
            <Text style={styles.chevron}>{expandedSections.has('taste') ? '▾' : '▸'}</Text>
          </TouchableOpacity>
          {expandedSections.has('taste') && (
            <>
              <DietaryTagInput tags={tasteTags} onTagsChange={handleTasteChange} placeholder="输入偏好，如：川菜、清淡" />
              <Text style={styles.itemCount}>{tasteTags.length} 项</Text>
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
              <View style={styles.apiTypeRow}>
                <TouchableOpacity
                  style={[styles.apiTypeChip, apiType === 'deepseek' && styles.apiTypeChipActive]}
                  onPress={() => { setApiType('deepseek'); autoSave({ apiType: 'deepseek' }); }}
                >
                  <Text style={[styles.apiTypeText, apiType === 'deepseek' && styles.apiTypeTextActive]}>DeepSeek</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.apiTypeChip, apiType === 'openai' && styles.apiTypeChipActive]}
                  onPress={() => { setApiType('openai'); autoSave({ apiType: 'openai' }); }}
                >
                  <Text style={[styles.apiTypeText, apiType === 'openai' && styles.apiTypeTextActive]}>OpenAI 兼容</Text>
                </TouchableOpacity>
              </View>

              {apiType === 'deepseek' && (
                <>
                  <DropdownSelector
                    label="选择模型"
                    options={DEEPSEEK_MODELS}
                    selectedValue={modelName}
                    onSelect={(val) => { setModelName(val); autoSave({ modelName: val }); }}
                  />
                  <View style={styles.switchRow}>
                    <View style={styles.switchLabelWrap}>
                      <Text style={styles.switchLabel}>思考模式</Text>
                      <Text style={styles.switchHint}>开启后 AI 推理更精准，但生成时间更长</Text>
                    </View>
                    <Switch
                      value={thinkingEnabled}
                      onValueChange={(val) => { setThinkingEnabled(val); autoSave({ thinkingEnabled: val }); }}
                      trackColor={{ false: COLORS.border, true: COLORS.primary }}
                      thumbColor="#fff"
                    />
                  </View>
                  {thinkingEnabled && (
                    <View style={styles.reasoningRow}>
                      <Text style={styles.hint}>思考强度</Text>
                      <View style={styles.chipRow}>
                        {REASONING_OPTIONS.map((opt) => (
                          <TouchableOpacity
                            key={opt.value}
                            style={[styles.reasoningChip, reasoningEffort === opt.value && styles.reasoningChipActive]}
                            onPress={() => { setReasoningEffort(opt.value); autoSave({ reasoningEffort: opt.value }); }}
                          >
                            <Text style={[styles.reasoningChipText, reasoningEffort === opt.value && styles.reasoningChipTextActive]}>{opt.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </>
              )}

              {apiType === 'openai' && (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="API 地址 (如 https://api.openai.com/v1)"
                    value={apiUrl}
                    onChangeText={setApiUrl}
                    placeholderTextColor={COLORS.textTertiary}
                    onSubmitEditing={() => autoSave({ apiUrl })}
                    onBlur={() => { if (apiUrl.trim()) autoSave({ apiUrl: apiUrl.trim() }); }}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="模型名称 (如 gpt-4o)"
                    value={modelName}
                    onChangeText={setModelName}
                    placeholderTextColor={COLORS.textTertiary}
                    onSubmitEditing={() => autoSave({ modelName })}
                    onBlur={() => { if (modelName.trim()) autoSave({ modelName: modelName.trim() }); }}
                  />
                </>
              )}

              <Text style={styles.apiKeyLabel}>API Key: {maskedKey}</Text>
              <TextInput
                style={styles.input}
                placeholder="输入新的 API Key (sk-...)"
                placeholderTextColor={COLORS.textTertiary}
                value={apiKeyInput}
                onChangeText={setApiKeyInput}
                secureTextEntry={!showApiKey}
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
            <View style={styles.dataRow}>
              <TouchableOpacity style={styles.dataBtn} onPress={handleExport} activeOpacity={0.7}>
                <Ionicons name="arrow-up-outline" size={20} color={COLORS.primary} />
                <Text style={styles.dataBtnText}>导出库存</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dataBtn} onPress={handleImport} activeOpacity={0.7}>
                <Ionicons name="arrow-down-outline" size={20} color={COLORS.primary} />
                <Text style={styles.dataBtnText}>导入库存</Text>
              </TouchableOpacity>
            </View>
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
  apiTypeRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  apiTypeChip: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  apiTypeChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryBg },
  apiTypeText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  apiTypeTextActive: { color: COLORS.primary, fontWeight: '600' },
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
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
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
});
