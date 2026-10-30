import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { Button } from './Button';
import type { EditDiffLine } from '../services/menuEditService';

/**
 * 菜谱变更预览。
 *
 * 刻意做成独立的模态面板，而不是塞在聊天气泡里：
 * 聊天流里一行"• 把盐从2g改成3g"既看不到实际数值变化，也没法逐条取舍。
 * 这里按菜品分组、逐项可勾选，确认的是**具体改了哪几个数字**。
 */
export function RecipeChangeReview({
  visible,
  lines,
  applying = false,
  onCancel,
  onApply,
}: {
  visible: boolean;
  lines: EditDiffLine[];
  applying?: boolean;
  onCancel: () => void;
  onApply: (selectedIndexes: number[]) => void;
}) {
  const { height } = useWindowDimensions();
  const [deselected, setDeselected] = useState<Set<number>>(new Set());

  const selectedCount = lines.length - deselected.size;
  const allSelected = deselected.size === 0;

  const groups = useMemo(() => {
    const map = new Map<string, EditDiffLine[]>();
    for (const line of lines) {
      const list = map.get(line.dish) || [];
      list.push(line);
      map.set(line.dish, list);
    }
    return [...map.entries()];
  }, [lines]);

  const toggle = (index: number) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    setDeselected((prev) => (prev.size === 0 ? new Set(lines.map((l) => l.index)) : new Set()));
  };

  const handleApply = () => {
    onApply(lines.filter((l) => !deselected.has(l.index)).map((l) => l.index));
  };

  const kindIcon = (kind: EditDiffLine['kind']) => {
    if (kind === 'add') return { name: 'add-circle' as const, color: COLORS.success };
    if (kind === 'remove') return { name: 'remove-circle' as const, color: COLORS.danger };
    return { name: 'swap-horizontal' as const, color: COLORS.primary };
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <View style={[styles.panel, { maxHeight: height * 0.72 }]}>
          <View style={styles.header}>
            <View style={styles.headerHandle} />
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.title}>菜谱变更</Text>
                <Text style={styles.subtitle}>
                  {lines.length} 处改动 · 影响 {groups.length} 项
                </Text>
              </View>
              <TouchableOpacity onPress={onCancel} hitSlop={12}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {groups.map(([dish, rows]) => (
              <View key={dish} style={styles.group}>
                <Text style={styles.groupTitle}>{dish}</Text>
                {rows.map((line) => {
                  const checked = !deselected.has(line.index);
                  const icon = kindIcon(line.kind);
                  return (
                    <TouchableOpacity
                      key={line.index}
                      style={styles.row}
                      onPress={() => toggle(line.index)}
                      activeOpacity={0.6}
                    >
                      <Ionicons
                        name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                        size={22}
                        color={checked ? COLORS.primary : COLORS.textTertiary}
                      />
                      <Ionicons name={icon.name} size={16} color={icon.color} style={styles.kindIcon} />
                      <Text style={[styles.rowText, !checked && styles.rowTextOff]}>
                        {line.text}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity onPress={toggleAll} hitSlop={8}>
              <Text style={styles.selectAll}>{allSelected ? '全不选' : '全选'}</Text>
            </TouchableOpacity>
            <View style={styles.footerButtons}>
              <Button title="取消" variant="ghost" onPress={onCancel} />
              <Button
                title={applying ? '应用中…' : `应用 ${selectedCount} 处`}
                variant="primary"
                onPress={handleApply}
                disabled={applying || selectedCount === 0}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: SPACING.lg,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: SPACING.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: TYPOGRAPHY.h4,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  body: {
    padding: SPACING.lg,
  },
  group: {
    marginBottom: SPACING.lg,
  },
  groupTitle: {
    fontSize: TYPOGRAPHY.bodySmall,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
    letterSpacing: 0.3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.neutralLight,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.xs,
  },
  kindIcon: {
    marginLeft: SPACING.sm,
    marginRight: SPACING.sm,
  },
  rowText: {
    flex: 1,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    lineHeight: 20,
  },
  rowTextOff: {
    color: COLORS.textTertiary,
    textDecorationLine: 'line-through',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  selectAll: {
    fontSize: TYPOGRAPHY.bodySmall,
    color: COLORS.primary,
    fontWeight: '600',
  },
  footerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
});

export default RecipeChangeReview;
