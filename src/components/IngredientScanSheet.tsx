import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { useSettings } from '../contexts/SettingsContext';
import { recognizeIngredients } from '../services/visionService';
import { SheetShell } from './DishSheets';
import { Button } from './Button';

/**
 * 「＋」点开后的入口：手动输入 / 拍照识别。
 *
 * 为什么不是两颗弹出来的浮动小球：那是纯动画，得手写 spring + 绝对定位，
 * 点击目标还小；而这个弹层是现成组件，识别完的确认清单也正好装在里面。
 *
 * 识别结果**必须先确认再入库**：模型把"老抽"认成"可乐"时，直接写库没人会发现。
 * 重量一律留空 —— 照片里看不出克数，编一个会让后面"用多少"的计算全错。
 */
export function IngredientScanSheet({
  visible,
  onClose,
  onManual,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onManual: () => void;
  onAdd: (names: string[]) => Promise<void>;
}) {
  const { state } = useSettings();
  const prefs = state.preferences;
  const [stage, setStage] = useState<'menu' | 'scanning' | 'review'>('menu');
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // 每次重新打开都从头开始，别把上次的残留结果带出来
  useEffect(() => {
    if (visible) {
      setStage('menu');
      setNames([]);
      setError('');
      setSaving(false);
    }
  }, [visible]);

  const handleShot = useCallback(async () => {
    setError('');
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('没拿到相机权限，去系统设置里给「随煮」打开');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true, allowsEditing: false });
    const asset = shot.canceled ? undefined : shot.assets?.[0];
    if (!asset?.base64) return; // 用户自己取消的，不算错

    setStage('scanning');
    const dataUrl = `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}`;
    const result = await recognizeIngredients(prefs, dataUrl);
    if (!result.ok) {
      setError(result.error ?? '识别失败，再试一次');
      setStage('menu');
      return;
    }
    setNames(result.names);
    setStage('review');
  }, [prefs]);

  const handleSave = useCallback(async () => {
    const picked = names.map((n) => n.trim()).filter((n) => n.length > 0);
    if (picked.length === 0) return;
    setSaving(true);
    await onAdd(picked);
    setSaving(false);
    onClose();
  }, [names, onAdd, onClose]);

  const title = stage === 'review' ? '确认这些食材' : '添加食材';
  const subtitle = stage === 'review'
    ? '改错的名字、删掉认错的，重量留空，入库后自己补'
    : undefined;

  return (
    <SheetShell visible={visible} title={title} subtitle={subtitle} onClose={onClose}>
      {stage === 'menu' && (
        <View style={styles.body}>
          <TouchableOpacity style={styles.option} onPress={handleShot} activeOpacity={0.7}>
            <Ionicons name="camera-outline" size={22} color={COLORS.primary} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>拍照识别</Text>
              <Text style={styles.optionHint}>对着冰箱或台面拍一张，认出里面有什么</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.option}
            onPress={() => {
              onClose();
              onManual();
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="pencil-outline" size={22} color={COLORS.primary} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>手动输入</Text>
              <Text style={styles.optionHint}>一次只加一样，可以填重量和入库日期</Text>
            </View>
          </TouchableOpacity>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      )}

      {stage === 'scanning' && (
        <View style={styles.scanning}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.scanningText}>正在看照片…</Text>
        </View>
      )}

      {stage === 'review' && (
        <>
          <ScrollView style={styles.body} contentContainerStyle={styles.reviewContent} keyboardShouldPersistTaps="handled">
            {names.map((name, idx) => (
              <View key={`${idx}-${name}`} style={styles.reviewRow}>
                <TextInput
                  style={styles.reviewInput}
                  value={name}
                  onChangeText={(t) => setNames((prev) => prev.map((n, i) => (i === idx ? t : n)))}
                  maxLength={12}
                  accessibilityLabel={`第 ${idx + 1} 个食材`}
                />
                <TouchableOpacity
                  onPress={() => setNames((prev) => prev.filter((_, i) => i !== idx))}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.reviewDelete}
                  accessibilityLabel={`删掉${name}`}
                >
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <View style={styles.footer}>
            <Button
              title={`加入库存（${names.filter((n) => n.trim()).length}）`}
              onPress={handleSave}
              loading={saving}
              disabled={names.filter((n) => n.trim()).length === 0}
            />
          </View>
        </>
      )}
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 0, flexShrink: 1, padding: SPACING.lg, gap: SPACING.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary },
  optionHint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, lineHeight: 17 },
  error: { fontSize: TYPOGRAPHY.caption, color: COLORS.danger, lineHeight: 17 },

  scanning: { paddingVertical: SPACING.xxl, alignItems: 'center', gap: SPACING.md },
  scanningText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },

  reviewContent: { gap: SPACING.sm },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  reviewInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    height: 44,
    paddingHorizontal: SPACING.md,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
  },
  reviewDelete: { padding: 6 },
  footer: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
});
