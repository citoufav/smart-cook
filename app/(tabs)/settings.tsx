import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Alert,
  TouchableOpacity,
  Modal,
  FlatList,
  Switch,
  StyleSheet,
} from 'react-native';
import { useSettings } from '../../src/contexts/SettingsContext';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ApiType } from '../../src/types';

const DEEPSEEK_MODELS = [
  { label: 'deepseek-v4-pro（旗舰模型）', value: 'deepseek-v4-pro' },
  { label: 'deepseek-v4-flash（快速模型）', value: 'deepseek-v4-flash' },
];

const REASONING_OPTIONS: { label: string; value: 'high' | 'max' }[] = [
  { label: '高', value: 'high' },
  { label: '最大', value: 'max' },
];

// ---- 下拉选择器组件 ----
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

// ---- 忌口标签组件 ----
function DietaryTagInput({
  tags,
  onTagsChange,
}: {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
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
          placeholder="输入忌口项，如：不吃辣"
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

export default function SettingsScreen() {
  const { state, updateApiKey, updatePreferences } = useSettings();
  const { preferences } = state;

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelName, setModelName] = useState(preferences.modelName);
  const [apiUrl, setApiUrl] = useState(preferences.apiUrl);
  const [apiType, setApiType] = useState<ApiType>(preferences.apiType);
  const [thinkingEnabled, setThinkingEnabled] = useState(preferences.thinkingEnabled);
  const [reasoningEffort, setReasoningEffort] = useState<'high' | 'max'>(
    preferences.reasoningEffort === 'high' || preferences.reasoningEffort === 'max'
      ? preferences.reasoningEffort
      : 'high',
  );
  const [dietaryTags, setDietaryTags] = useState<string[]>([...preferences.dietaryRestrictions]);

  const handleDietaryChange = useCallback(async (newTags: string[]) => {
    setDietaryTags(newTags);
    await updatePreferences({ dietaryRestrictions: newTags });
  }, [updatePreferences]);

  const handleSaveApiKey = useCallback(async () => {
    await updateApiKey(apiKeyInput);
    setApiKeyInput('');
    Alert.alert('已保存', 'API Key 已更新');
  }, [apiKeyInput, updateApiKey]);

  const handleSaveModel = useCallback(async () => {
    await updatePreferences({
      modelName,
      apiUrl,
      apiType,
      thinkingEnabled,
      reasoningEffort,
    });
    Alert.alert('已保存', '模型设置已更新');
  }, [modelName, apiUrl, apiType, thinkingEnabled, reasoningEffort, updatePreferences]);

  const maskedKey = preferences.apiKey
    ? preferences.apiKey.length <= 8
      ? '****'
      : preferences.apiKey.slice(0, 4) + '****' + preferences.apiKey.slice(-4)
    : '未设置';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.headerTitle}>设置</Text>

      {/* ---- 通用设置 ---- */}
      <Card title="模型设置">
        {/* API 类型选择 */}
        <View style={styles.apiTypeRow}>
          <TouchableOpacity
            style={[styles.apiTypeChip, apiType === 'deepseek' && styles.apiTypeChipActive]}
            onPress={() => setApiType('deepseek')}
          >
            <Text style={[styles.apiTypeText, apiType === 'deepseek' && styles.apiTypeTextActive]}>DeepSeek</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.apiTypeChip, apiType === 'openai' && styles.apiTypeChipActive]}
            onPress={() => setApiType('openai')}
          >
            <Text style={[styles.apiTypeText, apiType === 'openai' && styles.apiTypeTextActive]}>OpenAI 兼容</Text>
          </TouchableOpacity>
        </View>

        {/* DeepSeek 模型下拉 */}
        {apiType === 'deepseek' && (
          <>
            <DropdownSelector
              label="选择模型"
              options={DEEPSEEK_MODELS}
              selectedValue={modelName}
              onSelect={setModelName}
            />

            {/* 思考模式 */}
            <View style={styles.switchRow}>
              <View style={styles.switchLabelWrap}>
                <Text style={styles.switchLabel}>思考模式</Text>
                <Text style={styles.switchHint}>开启后AI推理更精准，但生成时间更长</Text>
              </View>
              <Switch
                value={thinkingEnabled}
                onValueChange={setThinkingEnabled}
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
                      style={[
                        styles.reasoningChip,
                        reasoningEffort === opt.value && styles.reasoningChipActive,
                      ]}
                      onPress={() => setReasoningEffort(opt.value)}
                    >
                      <Text
                        style={[
                          styles.reasoningChipText,
                          reasoningEffort === opt.value && styles.reasoningChipTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </>
        )}

        {/* OpenAI 兼容：API 地址 + 模型名自由输入 */}
        {apiType === 'openai' && (
          <>
            <TextInput
              style={styles.input}
              placeholder="API 地址 (如 https://api.openai.com/v1)"
              value={apiUrl}
              onChangeText={setApiUrl}
              placeholderTextColor={COLORS.textTertiary}
            />
            <TextInput
              style={styles.input}
              placeholder="模型名称 (如 gpt-4o)"
              value={modelName}
              onChangeText={setModelName}
              placeholderTextColor={COLORS.textTertiary}
            />
          </>
        )}

        {/* API Key（放在模型设置底部） */}
        <View style={styles.divider} />
        <Text style={styles.subSectionTitle}>API Key</Text>
        <View style={styles.apiKeyRow}>
          <Text style={styles.apiKeyLabel}>当前: {maskedKey}</Text>
        </View>
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

        {/* 模型设置保存按钮 */}
        <View style={styles.modelSaveRow}>
          <Button title="保存模型设置" variant="primary" size="sm" onPress={handleSaveModel} />
        </View>
      </Card>

      {/* ---- 忌口设置 ---- */}
      <Card title="忌口设置">
        <DietaryTagInput tags={dietaryTags} onTagsChange={handleDietaryChange} />
        <Text style={styles.itemCount}>{dietaryTags.length} 项</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingTop: 60, paddingBottom: SPACING.xl },
  headerTitle: { fontSize: TYPOGRAPHY.h1, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.xl },
  apiKeyRow: { marginBottom: SPACING.sm },
  apiKeyLabel: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  input: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, height: 44, paddingHorizontal: SPACING.md, fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary, marginBottom: SPACING.md, backgroundColor: COLORS.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  linkText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.primary },
  hint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginBottom: SPACING.sm },
  itemCount: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary, marginBottom: SPACING.sm, marginTop: SPACING.sm },
  apiTypeRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  apiTypeChip: { flex: 1, paddingVertical: SPACING.sm, alignItems: 'center', borderRadius: BORDER_RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border },
  apiTypeChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryBg },
  apiTypeText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  apiTypeTextActive: { color: COLORS.primary, fontWeight: '600' },

  // 下拉选择器
  dropdownWrapper: { marginBottom: SPACING.md },
  dropdownButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, height: 44, paddingHorizontal: SPACING.md, backgroundColor: COLORS.surface },
  dropdownButtonText: { flex: 1, fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary },
  dropdownArrow: { fontSize: 12, color: COLORS.textTertiary, marginLeft: SPACING.sm },
  modalOverlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'center', padding: SPACING.xxl },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, padding: SPACING.lg },
  modalTitle: { fontSize: TYPOGRAPHY.h3, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.lg },
  modalOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.md, paddingHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.xs },
  modalOptionActive: { backgroundColor: COLORS.primaryBg },
  modalOptionText: { fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary },
  modalOptionTextActive: { color: COLORS.primary, fontWeight: '600' },
  checkmark: { fontSize: 18, color: COLORS.primary, fontWeight: '700' },

  // 思考模式
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.sm, marginBottom: SPACING.sm },
  switchLabelWrap: { flex: 1, marginRight: SPACING.md },
  switchLabel: { fontSize: TYPOGRAPHY.body, fontWeight: '500', color: COLORS.textPrimary },
  switchHint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginTop: 2 },
  reasoningRow: { marginBottom: SPACING.md },
  chipRow: { flexDirection: 'row', gap: SPACING.sm },
  reasoningChip: { flex: 1, paddingVertical: SPACING.sm, alignItems: 'center', borderRadius: BORDER_RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border },
  reasoningChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryBg },
  reasoningChipText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  reasoningChipTextActive: { color: COLORS.primary, fontWeight: '600' },

  // 分隔线 + 子标题
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: SPACING.lg },
  subSectionTitle: { fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.sm },

  // 模型保存按钮
  modelSaveRow: { marginTop: SPACING.sm },

  // 忌口标签
  tagInputRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start' },
  tagInput: { flex: 1, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, height: 44, paddingHorizontal: SPACING.md, fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary, backgroundColor: COLORS.surface },
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
});
