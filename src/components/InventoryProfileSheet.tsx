import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { useInventory } from '../contexts/InventoryContext';
import { MAX_PROFILE_NAME, MAX_PROFILES } from '../services/inventoryProfileService';
import { SheetShell } from './DishSheets';

/**
 * 库存档案切换（家里 / 单位 …）。
 *
 * 只有**库存**分档案：我的菜、菜单记录、口味设置跟人走，不跟地点走。
 * 所以这里的措辞一律是「库存」，别让用户以为整个应用换了。
 */
export function InventoryProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { profiles, currentProfileId, switchProfile, createProfile } = useInventory();
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handlePick = useCallback(
    async (id: string) => {
      if (id === currentProfileId) {
        onClose();
        return;
      }
      setBusy(true);
      const ok = await switchProfile(id);
      setBusy(false);
      if (ok) onClose();
      else setError('切换失败，请重试');
    },
    [currentProfileId, onClose, switchProfile],
  );

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) {
      setError('给新档案起个名字');
      return;
    }
    if (profiles.some((p) => p.name === name)) {
      setError('已经有叫这个名字的档案了');
      return;
    }
    if (profiles.length >= MAX_PROFILES) {
      setError(`最多 ${MAX_PROFILES} 个档案`);
      return;
    }
    setBusy(true);
    const created = await createProfile(name);
    setBusy(false);
    if (!created) {
      setError('新建失败，请重试');
      return;
    }
    setNewName('');
    setError('');
    onClose();
  }, [createProfile, newName, onClose, profiles]);

  return (
    <SheetShell
      visible={visible}
      title="库存档案"
      subtitle="只有库存分开存，菜谱和记录是共用的"
      onClose={onClose}
    >
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        {profiles.map((profile) => {
          const current = profile.id === currentProfileId;
          return (
            <TouchableOpacity
              key={profile.id}
              style={[styles.row, current && styles.rowCurrent]}
              onPress={() => handlePick(profile.id)}
              activeOpacity={0.7}
              disabled={busy}
              accessibilityRole="radio"
              accessibilityState={{ selected: current }}
            >
              <Ionicons
                name={current ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={current ? COLORS.primary : COLORS.textTertiary}
              />
              <Text style={[styles.name, current && styles.nameCurrent]} numberOfLines={1}>
                {profile.name}
              </Text>
              {current && <Text style={styles.currentTag}>当前</Text>}
            </TouchableOpacity>
          );
        })}

        <View style={styles.addBlock}>
          <Text style={styles.addLabel}>再加一个</Text>
          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={(t) => {
                setNewName(t);
                setError('');
              }}
              placeholder="如：单位、宿舍、爸妈家"
              placeholderTextColor={COLORS.textTertiary}
              maxLength={MAX_PROFILE_NAME}
              returnKeyType="done"
              onSubmitEditing={handleCreate}
              accessibilityLabel="新档案名字"
            />
            <TouchableOpacity style={styles.addBtn} onPress={handleCreate} activeOpacity={0.7} disabled={busy}>
              <Text style={styles.addBtnText}>新建</Text>
            </TouchableOpacity>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.hint}>
            新建的档案是空的，库存要重新录；切回来还是原来那套。
          </Text>
        </View>
      </ScrollView>
    </SheetShell>
  );
}

/** 右上角那颗入口：显示当前档案名 */
export function InventoryProfileChip({ onPress }: { onPress: () => void }) {
  const { profiles, currentProfileId } = useInventory();
  const current = profiles.find((p) => p.id === currentProfileId);
  return (
    <TouchableOpacity style={styles.chip} onPress={onPress} activeOpacity={0.7} accessibilityLabel="切换库存档案">
      <Ionicons name="file-tray-stacked-outline" size={14} color={COLORS.primary} />
      <Text style={styles.chipText} numberOfLines={1}>
        {current?.name ?? '家里'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { padding: SPACING.lg, gap: SPACING.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rowCurrent: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryBg },
  name: { flex: 1, fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary },
  nameCurrent: { color: COLORS.primaryDark },
  currentTag: { fontSize: TYPOGRAPHY.caption, color: COLORS.primary, fontWeight: '600' },

  addBlock: { marginTop: SPACING.md, paddingTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border },
  addLabel: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.sm },
  addRow: { flexDirection: 'row', gap: SPACING.sm },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    height: 44,
    paddingHorizontal: SPACING.md,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
  },
  addBtn: {
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  addBtnText: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '700', color: COLORS.textWhite },
  error: { fontSize: TYPOGRAPHY.caption, color: COLORS.danger, marginTop: SPACING.sm },
  hint: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, lineHeight: 17, marginTop: SPACING.sm },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.primaryBg,
    maxWidth: 96,
  },
  chipText: { fontSize: TYPOGRAPHY.caption, fontWeight: '600', color: COLORS.primary },
});
