import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { SelectableChip } from './SelectableChip';
import type { Measurable } from '../hooks/useKeyboardAwareScroll';

/**
 * 「一堆标签 + 末尾一个＋」。
 *
 * 每个标签点一下选中/取消；最后那个虚线＋按下去才出现输入框，不占平时的版面。
 * 首启引导和设置抽屉共用，所以预设列表由外面传进来（见 constants/dietaryOptions.ts）。
 *
 * 自己加的项存在 `selected` 里（不在 items 里），所以渲染时并到末尾 ——
 * 不需要第二份「自定义列表」状态来同步。
 */
export function TagChipGroup({
  title,
  items,
  selected,
  onChange,
  addPlaceholder = '自己写一个',
  maxLength = 20,
  autoFocusInput = false,
  onInputFocus,
  style,
}: {
  title?: string;
  items: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  addPlaceholder?: string;
  maxLength?: number;
  autoFocusInput?: boolean;
  /** 键盘弹起时把输入框滚上来；子组件自己持 ref，所以交节点而不是 ref */
  onInputFocus?: (node: Measurable | null) => void;
  style?: object;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  const extras = selected.filter((s) => !items.includes(s));
  const all = [...items, ...extras];

  const toggle = (item: string) =>
    onChange(selected.includes(item) ? selected.filter((x) => x !== item) : [...selected, item]);

  const submit = () => {
    const value = text.trim().slice(0, maxLength);
    if (value && !selected.includes(value)) onChange([...selected, value]);
    setText('');
    setAdding(false);
  };

  return (
    <View style={style}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.chipWrap}>
        {all.map((item) => (
          <SelectableChip
            key={item}
            label={item}
            selected={selected.includes(item)}
            role="checkbox"
            onPress={() => toggle(item)}
          />
        ))}
        {!adding && (
          <TouchableOpacity
            style={styles.addChip}
            onPress={() => setAdding(true)}
            activeOpacity={0.7}
            accessibilityLabel={title ? `添加${title}` : '添加一项'}
          >
            <Text style={styles.addChipText}>＋</Text>
          </TouchableOpacity>
        )}
      </View>

      {adding && (
        <View style={styles.addRow}>
          <TextInput
            ref={inputRef}
            style={styles.addInput}
            value={text}
            onChangeText={setText}
            placeholder={addPlaceholder}
            placeholderTextColor={COLORS.textTertiary}
            maxLength={maxLength}
            autoFocus={autoFocusInput}
            returnKeyType="done"
            onSubmitEditing={submit}
            onFocus={() => onInputFocus?.(inputRef.current)}
            accessibilityLabel={title ? `${title}自定义输入` : '自定义输入'}
          />
          <TouchableOpacity style={styles.addBtn} onPress={submit} activeOpacity={0.7}>
            <Text style={styles.addBtnText}>加上</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => { setAdding(false); setText(''); }}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelBtnText}>取消</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, alignItems: 'center' },
  addChip: {
    width: 36,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.textTertiary,
  },
  addChipText: { fontSize: 16, color: COLORS.textSecondary, fontWeight: '600' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.sm },
  addInput: {
    flex: 1,
    height: 40,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    fontSize: TYPOGRAPHY.bodySmall,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.surface,
  },
  addBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  addBtnText: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '700', color: COLORS.textWhite },
  cancelBtn: { paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm },
  cancelBtnText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textTertiary },
});
