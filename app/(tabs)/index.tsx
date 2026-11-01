import { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  Platform,
  ToastAndroid,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useInventory } from '../../src/contexts/InventoryContext';
import { useNutrition } from '../../src/contexts/NutritionContext';
import { Ingredient, Seasoning, SeasoningStatus } from '../../src/types';
import { COLORS, SEASONING_STATUS_LABEL, SEASONING_STATUS_COLORS } from '../../src/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import { EmptyState } from '../../src/components/EmptyState';
import { FAB } from '../../src/components/FAB';
import { Badge, seasoningStatusToBadge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { useCustomAlert } from '../../src/components/CustomAlert';
import { useSettingsDrawer } from '../../src/contexts/SettingsDrawerContext';
import HeaderBar from '../../src/components/HeaderBar';
import { InventoryProfileChip, InventoryProfileSheet } from '../../src/components/InventoryProfileSheet';
import { useKeyboardHeight } from '../../src/hooks/useKeyboardHeight';
import { daysSince } from '../../src/utils/daysSince';

export default function InventoryScreen() {
  const { state, addIngredient, deleteIngredient, updateIngredient, addSeasoning, deleteSeasoning, updateSeasoning } = useInventory();
  const { hideBall } = useNutrition();
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const keyboardHeight = useKeyboardHeight();

  useFocusEffect(
    useCallback(() => {
      hideBall();
    }, [hideBall]),
  );
  const [activeTab, setActiveTab] = useState<'ingredients' | 'seasonings'>('ingredients');
  const [searchText, setSearchText] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formWeight, setFormWeight] = useState('');
  const [formStatus, setFormStatus] = useState<SeasoningStatus>('sufficient');
  const [formDate, setFormDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null); // Edit mode: ID of the item being edited
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Date picker ScrollView refs — scroll the selected item to center when the modal opens
  const yearScrollRef = useRef<ScrollView>(null);
  const monthScrollRef = useRef<ScrollView>(null);
  const dayScrollRef = useRef<ScrollView>(null);
  const ITEM_HEIGHT = 34;
  const SCROLL_HEIGHT = 180;

  // Date picker state
  const today = useMemo(() => new Date(), []);
  const [pickerYear, setPickerYear] = useState(today.getFullYear());
  const [pickerMonth, setPickerMonth] = useState(today.getMonth() + 1);
  const [pickerDay, setPickerDay] = useState(today.getDate());
  const years = Array.from({ length: 11 }, (_, i) => today.getFullYear() - 5 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const getDaysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
  const days = Array.from({ length: getDaysInMonth(pickerYear, pickerMonth) }, (_, i) => i + 1);

  useEffect(() => {
    if (showDatePicker) {
      const yearIdx = years.indexOf(pickerYear);
      const monthIdx = pickerMonth - 1;
      const dayIdx = pickerDay - 1;
      const center = (SCROLL_HEIGHT - ITEM_HEIGHT) / 2;
      const yearY = Math.max(0, yearIdx * ITEM_HEIGHT - center);
      const monthY = Math.max(0, monthIdx * ITEM_HEIGHT - center);
      const dayY = Math.max(0, dayIdx * ITEM_HEIGHT - center);
      setTimeout(() => {
        yearScrollRef.current?.scrollTo({ y: yearY, animated: false });
        monthScrollRef.current?.scrollTo({ y: monthY, animated: false });
        dayScrollRef.current?.scrollTo({ y: dayY, animated: false });
      }, 50);
    }
  }, [showDatePicker]);

  const { showAlert } = useCustomAlert();
  const { openSettings } = useSettingsDrawer();

  const filteredIngredients = useMemo(() => {
    const search = searchText.toLowerCase();
    return state.ingredients.filter((i) => i.name.toLowerCase().includes(search));
  }, [state.ingredients, searchText]);

  const filteredSeasonings = useMemo(() => {
    const search = searchText.toLowerCase();
    return state.seasonings.filter((s) => s.name.toLowerCase().includes(search));
  }, [state.seasonings, searchText]);

  const resetForm = useCallback(() => {
    setFormName('');
    setFormWeight('');
    setFormStatus('sufficient');
    setFormDate('');
    setFormError(null);
    setEditId(null);
    setShowForm(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    const name = formName.trim();
    if (!name) {
      setFormError(activeTab === 'ingredients' ? '食材名称不能为空' : '调料名称不能为空');
      return;
    }
    if (activeTab === 'ingredients' && name.length > 50) {
      setFormError('名称最多50个字符');
      return;
    }
    if (activeTab === 'seasonings' && name.length > 20) {
      setFormError('名称最多20个字符');
      return;
    }

    // 重名检查：编辑时把自己排除掉，否则改名成已有的名字会造出重复数据
    if (activeTab === 'ingredients') {
      if (state.ingredients.some((i) => i.name === name && i.id !== editId)) {
        setFormError('该名称已存在');
        return;
      }
    } else if (state.seasonings.some((s) => s.name === name && s.id !== editId)) {
      setFormError('该名称已存在');
      return;
    }

    setFormError(null);

    if (activeTab === 'ingredients') {
      const weight = formWeight.trim() ? parseFloat(formWeight) : null;
      if (weight !== null && (isNaN(weight) || weight <= 0 || weight > 50000 || !Number.isInteger(weight))) {
        setFormError('请输入有效的重量 (1-50000的整数)');
        return;
      }
      if (editId) {
        await updateIngredient(editId, { name, weight, createDate: formDate || undefined });
      } else {
        await addIngredient(name, weight, formDate || undefined);
      }
    } else {
      if (editId) {
        await updateSeasoning(editId, { name, status: formStatus });
      } else {
        await addSeasoning(name, formStatus);
      }
    }

    resetForm();
    // formDate must be listed: it is read inside this callback, and picking a new date
    // in the date-picker does not change any other dependency (stale-closure bug).
  }, [formName, formWeight, formStatus, formDate, activeTab, editId, addIngredient, updateIngredient, addSeasoning, updateSeasoning, state.ingredients, state.seasonings, resetForm]);

  // Tap a list item to enter edit mode
  const handleEditIngredient = useCallback((item: Ingredient) => {
    setEditId(item.id);
    setFormName(item.name);
    setFormWeight(item.weight !== null ? String(item.weight) : '');
    setFormDate(item.createDate ? item.createDate.slice(0, 10) : '');
    setShowForm(true);
  }, []);

  const handleEditSeasoning = useCallback((item: Seasoning) => {
    setEditId(item.id);
    setFormName(item.name);
    setFormStatus(item.status);
    setShowForm(true);
  }, []);

  // Re-buy reminder: reset one ingredient's storage date to now (recount "stored N days")
  const handleResetDate = useCallback((id: string, name: string) => {
    showAlert({
      title: '重置入库时间？',
      message: `「${name}」会记成今天新买的，"已存 N 天"从今天重新算。`,
      buttons: [
        { text: '取消', style: 'cancel' },
        {
          text: '重置',
          onPress: () => {
            updateIngredient(id, { createDate: new Date().toISOString() });
            // ponytail: 用 Android 原生 toast 给误触兜底，iOS 端静默；要上 iOS 时换成自绘 toast
            if (Platform.OS === 'android') {
              ToastAndroid.show(`「${name}」的入库日期已重置为今天`, ToastAndroid.SHORT);
            }
          },
        },
      ],
    });
  }, [updateIngredient, showAlert]);

  const handleDelete = useCallback((id: string, name: string) => {
    showAlert({ title: '确认删除', message: `确定要删除"${name}"吗？此操作不可恢复。`, buttons: [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          if (activeTab === 'ingredients') {
            await deleteIngredient(id);
          } else {
            await deleteSeasoning(id);
          }
        },
      },
    ] });
  }, [activeTab, deleteIngredient, deleteSeasoning, showAlert]);

  const handleOpenDatePicker = useCallback(() => {
    if (formDate) {
      const [y, m, d] = formDate.split('-').map(Number);
      if (y && m && d) { setPickerYear(y); setPickerMonth(m); setPickerDay(d); }
    } else {
      setPickerYear(today.getFullYear()); setPickerMonth(today.getMonth() + 1); setPickerDay(today.getDate());
    }
    setShowDatePicker(true);
  }, [formDate, today]);

  const handleDateConfirm = useCallback(() => {
    const d = String(pickerDay).padStart(2, '0');
    const m = String(pickerMonth).padStart(2, '0');
    setFormDate(`${pickerYear}-${m}-${d}`);
    setShowDatePicker(false);
  }, [pickerYear, pickerMonth, pickerDay]);

  const renderIngredientItem = ({ item }: { item: Ingredient }) => (
    <TouchableOpacity style={styles.listItem} onPress={() => handleEditIngredient(item)} activeOpacity={0.7}>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemMeta}>
          {item.weight !== null ? `${item.weight} 克` : '未称量'} · 已存 {daysSince(item.createDate)} 天
        </Text>
      </View>
      <TouchableOpacity onPress={() => handleResetDate(item.id, item.name)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 8 }} accessibilityLabel={`重置${item.name}的入库日期`}>
        <Ionicons name="refresh-outline" size={20} color={COLORS.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => handleDelete(item.id, item.name)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 8 }}>
        <Ionicons name="trash-outline" size={20} color={COLORS.textTertiary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderSeasoningItem = ({ item }: { item: Seasoning }) => (
    <TouchableOpacity style={styles.listItem} onPress={() => handleEditSeasoning(item)} activeOpacity={0.7}>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Badge
          variant={seasoningStatusToBadge(item.status)}
          label={SEASONING_STATUS_LABEL[item.status]}
        />
      </View>
      <TouchableOpacity onPress={() => handleDelete(item.id, item.name)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 8 }}>
        <Ionicons name="trash-outline" size={20} color={COLORS.textTertiary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const currentList = activeTab === 'ingredients' ? filteredIngredients : filteredSeasonings;
  const isEmpty = activeTab === 'ingredients'
    ? state.ingredients.length === 0
    : state.seasonings.length === 0;
  // 有数据但搜索无命中：不能走 isEmpty，否则是一片白屏
  const noResults = !isEmpty && currentList.length === 0;
  const itemNoun = activeTab === 'ingredients' ? '食材' : '调料';

  return (
    <View style={styles.container}>
      <HeaderBar
        title="随煮"
        onOpenDrawer={openSettings}
        right={<InventoryProfileChip onPress={() => setProfileSheetOpen(true)} />}
      />

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'ingredients' && styles.tabActive]}
          onPress={() => setActiveTab('ingredients')}
        >
          <Text style={[styles.tabText, activeTab === 'ingredients' && styles.tabTextActive]}>食材</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'seasonings' && styles.tabActive]}
          onPress={() => setActiveTab('seasonings')}
        >
          <Text style={[styles.tabText, activeTab === 'seasonings' && styles.tabTextActive]}>调料</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="搜索..."
          placeholderTextColor={COLORS.textTertiary}
          value={searchText}
          onChangeText={setSearchText}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')}>
            <Text style={styles.clearBtn}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {isEmpty ? (
        <EmptyState
          icon="🛒"
          title="库存为空"
          description="先添加一些食材和调料，才能开始做菜哦"
          action={{ label: activeTab === 'ingredients' ? '添加第一个食材' : '添加第一个调料', onPress: () => setShowForm(true) }}
        />
      ) : noResults ? (
        <EmptyState
          icon="🔍"
          title="没有找到"
          description={`没有名字包含「${searchText.trim()}」的${itemNoun}`}
          action={{ label: '清除搜索', onPress: () => setSearchText('') }}
        />
      ) : (
        <FlatList<Ingredient | Seasoning>
          data={currentList}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) =>
            activeTab === 'ingredients'
              ? renderIngredientItem({ item: item as Ingredient })
              : renderSeasoningItem({ item: item as Seasoning })
          }
          contentContainerStyle={styles.list}
        />
      )}

      {showForm && (
        <View style={[styles.formOverlay, { paddingBottom: SPACING.xxl + keyboardHeight }]}>
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {editId ? '编辑' : '添加'}{activeTab === 'ingredients' ? '食材' : '调料'}
            </Text>
            <TextInput
              style={[styles.formInput, formError && styles.formInputError]}
              placeholder={activeTab === 'ingredients' ? '食材名称' : '调料名称'}
              placeholderTextColor={COLORS.textTertiary}
              value={formName}
              onChangeText={setFormName}
              autoFocus
            />
            {activeTab === 'ingredients' && (
              <>
                <TextInput
                  style={styles.formInput}
                  placeholder="重量（克，可留空）"
                  placeholderTextColor={COLORS.textTertiary}
                  value={formWeight}
                  onChangeText={(t) => setFormWeight(t.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                />
                <TouchableOpacity
                  style={styles.dateSelector}
                  onPress={handleOpenDatePicker}
                  activeOpacity={0.7}
                >
                  <Text style={formDate ? styles.dateText : styles.datePlaceholder}>
                    {formDate ? `${formDate.slice(0, 4)}年${formDate.slice(5, 7)}月${formDate.slice(8, 10)}日` : '选择入库日期（默认今天）'}
                  </Text>
                  <Ionicons name="caret-down-outline" size={14} color={COLORS.textTertiary} />
                </TouchableOpacity>
              </>
            )}
            {activeTab === 'seasonings' && (
              <View style={styles.statusRow}>
                {(['sufficient', 'low', 'out'] as SeasoningStatus[]).map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.statusChip, formStatus === s && styles.statusChipActive, { borderColor: SEASONING_STATUS_COLORS[s].text }]}
                    onPress={() => setFormStatus(s)}
                  >
                    <Text style={[styles.statusChipText, formStatus === s && { color: SEASONING_STATUS_COLORS[s].text }]}>
                      {SEASONING_STATUS_LABEL[s]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {formError && <Text style={styles.formError}>{formError}</Text>}
            <View style={styles.formButtons}>
              <Button title="取消" variant="ghost" onPress={resetForm} />
              <Button title="保存" variant="primary" onPress={handleSubmit} />
            </View>
          </View>
        </View>
      )}

      {/* Date picker modal */}
      <Modal visible={showDatePicker} transparent animationType="fade" onRequestClose={() => setShowDatePicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDatePicker(false)}>
          <View style={styles.datePickerCard}>
            <Text style={styles.datePickerTitle}>选择入库日期</Text>
            <View style={styles.pickerRow}>
              {/* Year */}
              <View style={styles.pickerCol}>
                <Text style={styles.pickerLabel}>年</Text>
                <ScrollView ref={yearScrollRef} style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                  {years.map((y) => (
                    <TouchableOpacity key={y} onPress={() => setPickerYear(y)} style={[styles.pickerItem, pickerYear === y && styles.pickerItemActive]}>
                      <Text style={[styles.pickerItemText, pickerYear === y && styles.pickerItemTextActive]}>{y}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              {/* Month */}
              <View style={styles.pickerCol}>
                <Text style={styles.pickerLabel}>月</Text>
                <ScrollView ref={monthScrollRef} style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                  {months.map((m) => (
                    <TouchableOpacity key={m} onPress={() => { setPickerMonth(m); setPickerDay(Math.min(pickerDay, getDaysInMonth(pickerYear, m))); }} style={[styles.pickerItem, pickerMonth === m && styles.pickerItemActive]}>
                      <Text style={[styles.pickerItemText, pickerMonth === m && styles.pickerItemTextActive]}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              {/* Day */}
              <View style={styles.pickerCol}>
                <Text style={styles.pickerLabel}>日</Text>
                <ScrollView ref={dayScrollRef} style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                  {days.map((d) => (
                    <TouchableOpacity key={d} onPress={() => setPickerDay(d)} style={[styles.pickerItem, pickerDay === d && styles.pickerItemActive]}>
                      <Text style={[styles.pickerItemText, pickerDay === d && styles.pickerItemTextActive]}>{d}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
            <View style={styles.datePickerBtns}>
              <Button title="取消" variant="ghost" onPress={() => setShowDatePicker(false)} />
              <Button title="确定" variant="primary" onPress={handleDateConfirm} />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {!showForm && <FAB icon="＋" onPress={() => setShowForm(true)} accessibilityLabel="添加" />}

      <InventoryProfileSheet visible={profileSheetOpen} onClose={() => setProfileSheetOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  tabRow: { flexDirection: 'row', backgroundColor: COLORS.surface, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab: { flex: 1, paddingVertical: SPACING.md, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { fontSize: TYPOGRAPHY.body, color: COLORS.textTertiary, fontWeight: '500' },
  tabTextActive: { color: COLORS.primary, fontWeight: '600' },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: SPACING.lg, marginVertical: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  searchInput: { flex: 1, height: 44, fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary },
  clearBtn: { fontSize: 16, color: COLORS.textTertiary, padding: SPACING.sm },
  list: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
  listItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: SPACING.lg, borderRadius: BORDER_RADIUS.md, marginBottom: SPACING.sm, ...SHADOWS.sm },
  itemInfo: { flex: 1 },
  itemName: { fontSize: TYPOGRAPHY.body, fontWeight: '500', color: COLORS.textPrimary },
  itemMeta: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  formOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLORS.overlay, justifyContent: 'center', padding: SPACING.xxl, zIndex: 200 },
  formCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, padding: SPACING.xxl },
  formTitle: { fontSize: TYPOGRAPHY.h3, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.lg },
  formInput: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, height: 44, paddingHorizontal: SPACING.md, fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary, marginBottom: SPACING.md },
  formInputError: { borderColor: COLORS.danger, backgroundColor: COLORS.dangerLight },
  formError: { fontSize: TYPOGRAPHY.caption, color: COLORS.danger, marginBottom: SPACING.sm },
  statusRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  statusChip: { flex: 1, paddingVertical: SPACING.sm, alignItems: 'center', borderRadius: BORDER_RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border },
  statusChipActive: { borderWidth: 2 },
  statusChipText: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary },
  formButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.md },
  // Date picker
  modalOverlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'center', padding: SPACING.xxl },
  datePickerCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, padding: SPACING.xxl },
  datePickerTitle: { fontSize: TYPOGRAPHY.h3, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.lg, textAlign: 'center' },
  pickerRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  pickerCol: { flex: 1, alignItems: 'center' },
  pickerLabel: { fontSize: TYPOGRAPHY.caption, color: COLORS.textTertiary, marginBottom: SPACING.xs },
  pickerScroll: { height: 180 },
  pickerItem: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.sm, height: 34, justifyContent: 'center' },
  pickerItemActive: { backgroundColor: COLORS.primaryBg },
  pickerItemText: { fontSize: TYPOGRAPHY.body, color: COLORS.textSecondary, textAlign: 'center' },
  pickerItemTextActive: { color: COLORS.primary, fontWeight: '700' },
  datePickerBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.md },
  // Date display
  dateSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.neutralLight,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  dateText: { fontSize: TYPOGRAPHY.body, color: COLORS.textPrimary },
  datePlaceholder: { fontSize: TYPOGRAPHY.body, color: COLORS.textTertiary },
});
