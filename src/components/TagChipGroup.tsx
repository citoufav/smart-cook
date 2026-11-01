import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { SelectableChip } from './SelectableChip';
import { useCustomAlert } from './CustomAlert';
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
  onlySelected = false,
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
  /**
   * 只显示已保存的（设置抽屉用）。
   * 引导页要的是"从一堆预设里挑"，抽屉要的是"看看我现在存了什么、点掉不想要的" ——
   * 把整张预设表铺在设置里，那是雷霆大表，不是设置。
   */
  onlySelected?: boolean;
  /** 键盘弹起时把输入框滚上来；子组件自己持 ref，所以交节点而不是 ref */
  onInputFocus?: (node: Measurable | null) => void;
  style?: object;
}) {
  const { showAlert } = useCustomAlert();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  const extras = selected.filter((s) => !items.includes(s));
  const all = onlySelected ? selected : [...items, ...extras];

  const remove = (item: string) => onChange(selected.filter((x) => x !== item));
  const add = (item: string) => onChange([...selected, item]);

  /**
   * 点一下取消很顺手，但设置里那是**删掉已经存下来的东西**，
   * 手滑一下就没了。所以只有"只显示已保存"的模式（设置抽屉）才弹确认；
   * 引导页里点掉一个未保存的勾选不需要问。
   */
  const handleChipPress = (item: string) => {
    const isOn = selected.includes(item);
    if (!isOn) {
      add(item);
      return;
    }
    if (!onlySelected) {
      remove(item);
      return;
    }
    showAlert({
      title: `取消「${item}」？`,
      message: '这条会从你的偏好里删掉，下次生成菜单就不再考虑它。',
      buttons: [
        { text: '保留', style: 'cancel' },
        { text: '删掉', style: 'destructive', onPress: () => remove(item) },
      ],
    });
  };

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
        {all.length === 0 && onlySelected ? (
          <Text style={styles.empty}>还没有，点右边＋添加</Text>
        ) : null}
        {all.map((item) => (
          <SelectableChip
            key={item}
            label={item}
            selected={selected.includes(item)}
            role="checkbox"
            onPress={() => handleChipPress(item)}
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
  empty: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary },
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
