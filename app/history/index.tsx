import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  TextInput,
  StyleSheet,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import { EmptyState } from '../../src/components/EmptyState';
import { Button } from '../../src/components/Button';
import { menuHistoryService, MenuHistoryItem } from '../../src/services/menuHistoryService';

export default function HistoryListScreen() {
  const [sessions, setSessions] = useState<MenuHistoryItem[]>([]);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const loadHistory = useCallback(async () => {
    const items = await menuHistoryService.getAllItems();
    setSessions(items);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory]),
  );

  const handleDelete = useCallback((id: string, name: string) => {
    Alert.alert('确认删除', `确定要删除"${name}"吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await menuHistoryService.remove(id);
          loadHistory();
        },
      },
    ]);
  }, [loadHistory]);

  const handleRenameStart = useCallback((item: MenuHistoryItem) => {
    setRenameId(item.id);
    setRenameText(item.name);
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameId || !renameText.trim()) return;
    await menuHistoryService.rename(renameId, renameText.trim());
    setRenameId(null);
    setRenameText('');
    loadHistory();
  }, [renameId, renameText, loadHistory]);

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon="📋"
        title="暂无历史记录"
        description="每次生成菜单后会自动保存到这里"
      />
    );
  }

  return (
    <FlatList
      data={sessions}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <View style={styles.item}>
          <TouchableOpacity
            style={styles.itemContent}
            onPress={() => router.push(`/history/${item.id}`)}
          >
            {renameId === item.id ? (
              <View style={styles.renameRow}>
                <TextInput
                  style={styles.renameInput}
                  value={renameText}
                  onChangeText={setRenameText}
                  autoFocus
                  onSubmitEditing={handleRenameConfirm}
                />
                <Button title="确定" variant="primary" size="sm" onPress={handleRenameConfirm} />
              </View>
            ) : (
              <Text style={styles.itemTitle}>{item.name}</Text>
            )}
            <Text style={styles.itemDate}>
              {new Date(item.createdAt).toLocaleString('zh-CN')}
              {item.menuProposal?.dishes?.length ? ` · ${item.menuProposal.dishes.length} 道菜` : ''}
            </Text>
          </TouchableOpacity>
          <View style={styles.itemActions}>
            <TouchableOpacity
              onPress={() => handleRenameStart(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.actionBtn}>✏️</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(item.id, item.name)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.actionBtn}>🗑️</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: SPACING.lg },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  itemContent: { flex: 1 },
  itemTitle: { fontSize: TYPOGRAPHY.body, fontWeight: '500', color: COLORS.textPrimary },
  itemDate: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: SPACING.xs },
  itemActions: { flexDirection: 'row', gap: SPACING.md, marginLeft: SPACING.sm },
  actionBtn: { fontSize: 18 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  renameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    fontSize: TYPOGRAPHY.bodySmall,
    color: COLORS.textPrimary,
  },
});
