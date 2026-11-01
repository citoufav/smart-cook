import { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../src/contexts/SettingsContext';
import { useInventory } from '../src/contexts/InventoryContext';
import { SelectableChip } from '../src/components/SelectableChip';
import { Button } from '../src/components/Button';
import { useKeyboardAwareScroll, type Measurable } from '../src/hooks/useKeyboardAwareScroll';
import { validateApiKey } from '../src/utils/validation';
import { COLORS } from '../src/constants/colors';
import { TYPOGRAPHY } from '../src/constants/typography';
import { SPACING, BORDER_RADIUS } from '../src/constants/spacing';

/** DeepSeek 开放平台的 Key 页面；没登录会自动跳登录页 */
const DEEPSEEK_KEY_URL = 'https://platform.deepseek.com/api_keys';

// Presets shown on first launch. Tapping a chip writes it into the same fields
// the AI prompt already reads, so no extra merge/sync logic is needed.
const CUISINES = [
  '家常菜', '川菜', '湘菜', '粤菜', '江浙菜', '东北菜', '西北菜', '云南菜',
  '日式', '韩式', '泰式', '东南亚', '意式', '美式', '地中海',
];
const FLAVORS = [
  '清淡', '少油', '重口', '微辣', '中辣', '特辣', '酸辣', '酸甜',
  '咸鲜', '香辣', '孜然', '蒜香', '甜口',
];
const ALLERGENS = [
  '花生', '坚果', '海鲜', '虾蟹', '贝类', '鱼类', '乳制品', '鸡蛋',
  '麸质', '大豆', '芝麻', '芒果',
];
const AVOIDANCES = [
  '不吃辣', '不吃猪肉', '不吃牛肉', '不吃羊肉', '不吃鸡肉', '不吃内脏',
  '不吃海鲜', '不吃鸡蛋', '不吃香菜', '不吃葱蒜', '不吃姜', '不吃菌菇',
];
// 常备食材：按「蔬菜 → 蛋白 → 主食 → 葱姜蒜」排，用户扫一眼就知道自己那几样在哪
const PANTRY_STAPLES = [
  '番茄', '土豆', '洋葱', '青椒', '胡萝卜', '白菜', '西兰花', '黄瓜',
  '茄子', '豆角', '菠菜', '香菇', '南瓜', '豆芽',
  '鸡蛋', '豆腐', '猪肉', '五花肉', '鸡胸肉', '牛肉', '虾仁', '鱼',
  '大米', '面条', '馒头', '红薯',
  '小葱', '大蒜', '姜',
];
// 常备调料：选中的直接以「充足」状态进调料库
const PANTRY_SEASONINGS = [
  '食用油', '盐', '生抽', '老抽', '醋', '料酒', '白糖', '淀粉',
  '蚝油', '胡椒粉', '辣椒油', '香油', '花椒', '豆瓣酱',
];

const TITLES = ['先配一个 AI Key', '你爱吃什么？', '你不能吃什么？', '家里现在有什么？'];
const SUBTITLES = [
  '这个 App 自己不做 AI，用的是你自己的 DeepSeek 账号。全程大约 5 分钟',
  '选几样，AI 推荐菜单时会优先照顾',
  '过敏和忌口会写进每次菜单生成，避免踩雷',
  '点选常备食材和调料直接加入库存，重量以后随时能改',
];
const TOTAL_STEPS = TITLES.length;

function toggleIn(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function ChipGroup({
  title,
  items,
  selected,
  onChange,
  addPlaceholder = '自己写一个',
  onInputFocus,
}: {
  title: string;
  items: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  addPlaceholder?: string;
  /** 键盘弹起时把输入框滚上来；子组件自己持 ref，所以传节点不给 ref */
  onInputFocus?: (node: Measurable | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  // 预设之外的自己填的，也要显示成 chip（已选中状态），否则加完就看不见了
  const extras = selected.filter((s) => !items.includes(s));
  const all = [...items, ...extras];

  const submit = () => {
    const value = text.trim();
    if (value && !selected.includes(value)) onChange([...selected, value]);
    setText('');
    setAdding(false);
  };

  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.chipWrap}>
        {all.map((item) => (
          <SelectableChip
            key={item}
            label={item}
            selected={selected.includes(item)}
            role="checkbox"
            onPress={() => onChange(toggleIn(selected, item))}
          />
        ))}
        {!adding && (
          <TouchableOpacity
            style={styles.addChip}
            onPress={() => setAdding(true)}
            activeOpacity={0.7}
            accessibilityLabel={`添加${title}`}
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
            maxLength={20}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            onFocus={() => onInputFocus?.(inputRef.current)}
            accessibilityLabel={`${title}自定义输入`}
          />
          <Button title="加上" variant="primary" size="sm" onPress={submit} />
          <Button title="取消" variant="ghost" size="sm" onPress={() => { setAdding(false); setText(''); }} />
        </View>
      )}
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { state: settingsState, updatePreferences, updateApiKey } = useSettings();
  const { state: invState, addIngredient, addSeasoning } = useInventory();
  const { scrollRef, onScroll, captureFocus, captureNode } = useKeyboardAwareScroll();
  const keyInputRef = useRef<TextInput>(null);

  const [step, setStep] = useState(0);
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState('');
  // 四组各存各的。菜系和口味最后都并进 tastePreferences、过敏和忌口都并进
  // dietaryRestrictions，但**界面上是两组**：共用一个数组会让「自己加的项」
  // 串到另一组去显示（选西北菜，口味那一组也会冒出来）
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [flavors, setFlavors] = useState<string[]>([]);
  const [allergens, setAllergens] = useState<string[]>([]);
  const [avoidances, setAvoidances] = useState<string[]>([]);
  const [pantry, setPantry] = useState<string[]>([]);
  const [pantrySeasonings, setPantrySeasonings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const openDeepSeek = useCallback(async () => {
    try {
      await Linking.openURL(DEEPSEEK_KEY_URL);
    } catch {
      setKeyError('打不开浏览器，可以自己搜「DeepSeek 开放平台」');
    }
  }, []);

  /** 输入框里填了就校验并保存；返回 false 表示格式不对，别往下走 */
  const saveKeyIfAny = useCallback(async (): Promise<boolean> => {
    const key = keyInput.trim();
    if (!key) return true;
    const error = validateApiKey(key);
    if (error) {
      setKeyError(error);
      return false;
    }
    await updateApiKey(key);
    setKeyInput('');
    setKeyError('');
    return true;
  }, [keyInput, updateApiKey]);

  // Skipping still keeps whatever was already picked on earlier steps.
  const finish = useCallback(async () => {
    setSaving(true);
    // 粘贴了但直接点「跳过/完成」的情况：合法就存下来，别让人白粘贴一次
    const pendingKey = keyInput.trim();
    if (pendingKey && !validateApiKey(pendingKey)) {
      await updateApiKey(pendingKey).catch(() => {});
    }
    await updatePreferences({
      // 合并回两个存储字段；用 Set 去重，万一两组里加了同一个自定义项
      tastePreferences: [...new Set([...cuisines, ...flavors])],
      dietaryRestrictions: [...new Set([...allergens, ...avoidances])],
      onboardingDone: true,
    });
    const existing = new Set(invState.ingredients.map((i) => i.name));
    for (const name of pantry) {
      if (existing.has(name)) continue;
      try {
        await addIngredient(name, null);
      } catch {
        // One failed write must not trap the user on the onboarding screen.
      }
    }
    const existingSeasonings = new Set(invState.seasonings.map((s) => s.name));
    for (const name of pantrySeasonings) {
      if (existingSeasonings.has(name)) continue;
      try {
        // 勾了就是"家里有"，所以直接记成充足；量以后再说
        await addSeasoning(name, 'sufficient');
      } catch {
        // 同上：一条写失败不该把人卡在引导页
      }
    }
    router.replace('/(tabs)');
  }, [cuisines, flavors, allergens, avoidances, pantry, pantrySeasonings, invState.ingredients, invState.seasonings, updatePreferences, addIngredient, addSeasoning, keyInput, updateApiKey]);

  const goNext = useCallback(async () => {
    if (step === 0 && !(await saveKeyIfAny())) return;
    setStep(step + 1);
  }, [step, saveKeyIfAny]);

  const isLast = step === TOTAL_STEPS - 1;
  const keyConfigured = Boolean(settingsState.preferences.apiKey);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <View style={styles.dots}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>
        {!isLast && (
          <TouchableOpacity onPress={finish} hitSlop={12}>
            <Text style={styles.skip}>跳过</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{TITLES[step]}</Text>
        <Text style={styles.subtitle}>{SUBTITLES[step]}</Text>

        {step === 0 && (
          <>
            <View style={styles.steps}>
              <Text style={styles.stepText}>
                <Text style={styles.stepNum}>1 </Text>
                <Text style={styles.stepBold}>登录或注册。</Text>
                点下面的按钮打开 DeepSeek 官网，登录或注册一个 DeepSeek 账户 —— 注意不是我们这个应用的账户。
              </Text>
              <Text style={styles.stepText}>
                <Text style={styles.stepNum}>2 </Text>
                <Text style={styles.stepBold}>充值。</Text>
                登录后进「充值」页面，按自己的用量充，几块钱就能生成很多次。
              </Text>
              <Text style={styles.stepText}>
                <Text style={styles.stepNum}>3 </Text>
                <Text style={styles.stepBold}>找到 API keys。</Text>
                在 DeepSeek 平台里点开左上角菜单，选「API keys」。
              </Text>
              <Text style={styles.stepText}>
                <Text style={styles.stepNum}>4 </Text>
                <Text style={styles.stepBold}>创建一个 Key。</Text>
                点「创建 API key」，名字随便填（比如 cook、做饭）。
              </Text>
              <Text style={styles.stepText}>
                <Text style={styles.stepNum}>5 </Text>
                <Text style={styles.stepBold}>复制，粘贴。</Text>
                复制那串 sk- 开头的字符，粘到下面的框里，点「下一步」。
              </Text>
            </View>

            <Button title="打开 DeepSeek 官网" variant="primary" onPress={openDeepSeek} />

            <Text style={styles.fieldLabel}>把 Key 粘贴到这里</Text>
            <TextInput
              ref={keyInputRef}
              style={[styles.keyInput, keyError ? styles.keyInputError : null]}
              placeholder="sk-..."
              placeholderTextColor={COLORS.textTertiary}
              value={keyInput}
              onChangeText={(t) => { setKeyInput(t); setKeyError(''); }}
              onFocus={captureFocus(keyInputRef)}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              accessibilityLabel="API Key 输入框"
            />
            {keyError ? <Text style={styles.keyError}>{keyError}</Text> : null}
            {keyConfigured && !keyInput ? (
              <Text style={styles.keyOk}>已经配好了，可以直接下一步。</Text>
            ) : null}
            <Text style={styles.note}>
              这一步可以跳过，以后在设置里随时能补；但没有 Key 的时候，AI 生成菜单会用不了。
            </Text>
          </>
        )}
        {step === 1 && (
          <>
            <ChipGroup title="偏爱菜系" items={CUISINES} selected={cuisines} onChange={setCuisines} addPlaceholder="其他菜系，如：东北菜" onInputFocus={captureNode} />
            <ChipGroup title="口味倾向" items={FLAVORS} selected={flavors} onChange={setFlavors} addPlaceholder="其他口味，如：咖喱" onInputFocus={captureNode} />
          </>
        )}
        {step === 2 && (
          <>
            <ChipGroup title="过敏（务必勾选）" items={ALLERGENS} selected={allergens} onChange={setAllergens} addPlaceholder="其他过敏原，如：菠萝" onInputFocus={captureNode} />
            <ChipGroup title="忌口" items={AVOIDANCES} selected={avoidances} onChange={setAvoidances} addPlaceholder="其他忌口，如：不吃苦瓜" onInputFocus={captureNode} />
          </>
        )}
        {step === 3 && (
          <>
            <ChipGroup title="常备食材" items={PANTRY_STAPLES} selected={pantry} onChange={setPantry} addPlaceholder="其他食材，如：玉米" onInputFocus={captureNode} />
            <ChipGroup title="常备调料" items={PANTRY_SEASONINGS} selected={pantrySeasonings} onChange={setPantrySeasonings} addPlaceholder="其他调料，如：咖喱块" onInputFocus={captureNode} />
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.lg }]}>
        {step > 0 && (
          <Button title="上一步" variant="ghost" onPress={() => setStep(step - 1)} />
        )}
        <Button
          title={isLast ? `完成${pantry.length + pantrySeasonings.length > 0 ? `（加入 ${pantry.length + pantrySeasonings.length} 项）` : ''}` : '下一步'}
          variant="primary"
          loading={saving}
          style={styles.grow}
          onPress={isLast ? finish : goNext}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  dots: { flexDirection: 'row', gap: SPACING.xs },
  dot: { width: 22, height: 4, borderRadius: BORDER_RADIUS.full, backgroundColor: COLORS.border },
  dotActive: { backgroundColor: COLORS.primary },
  skip: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textTertiary },
  content: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  title: { fontSize: TYPOGRAPHY.h2, fontWeight: '700', color: COLORS.textPrimary },
  subtitle: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, marginTop: SPACING.sm },
  group: { marginTop: SPACING.xxl },
  groupTitle: {
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

  // API Key 那一步
  steps: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginTop: SPACING.xl,
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  stepText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textBody, lineHeight: 21 },
  stepNum: { fontWeight: '700', color: COLORS.primary },
  stepBold: { fontWeight: '700', color: COLORS.textPrimary },
  fieldLabel: {
    fontSize: TYPOGRAPHY.bodySmall,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
  },
  keyInput: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    height: 46,
    paddingHorizontal: SPACING.md,
    fontSize: TYPOGRAPHY.bodySmall,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.surface,
  },
  keyInputError: { borderColor: COLORS.danger, backgroundColor: COLORS.dangerLight },
  keyError: { fontSize: TYPOGRAPHY.caption, color: COLORS.danger, marginTop: SPACING.sm },
  keyOk: { fontSize: TYPOGRAPHY.caption, color: COLORS.success, marginTop: SPACING.sm },
  note: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, lineHeight: 18, marginTop: SPACING.md },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  grow: { flex: 1 },
});
