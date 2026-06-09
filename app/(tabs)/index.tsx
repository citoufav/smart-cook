import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Animated,
} from 'react-native';
import { router } from 'expo-router';
import { useInventory } from '../../src/contexts/InventoryContext';
import { Ingredient, Seasoning, SeasoningStatus } from '../../src/types';
import { COLORS, SEASONING_STATUS_LABEL, SEASONING_STATUS_COLORS } from '../../src/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../../src/constants/spacing';
import { EmptyState } from '../../src/components/EmptyState';
import { FAB } from '../../src/components/FAB';
import { Badge, seasoningStatusToBadge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Checkbox } from '../../src/components/Checkbox';

function getDaysSince(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / 86400000);
}

export default function InventoryScreen() {
  const { state, addIngredient, deleteIngredient, updateIngredient, addSeasoning, deleteSeasoning, updateSeasoning } = useInventory();
  const [activeTab, setActiveTab] = useState<'ingredients' | 'seasonings'>('ingredients');
  const [searchText, setSearchText] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formWeight, setFormWeight] = useState('');
  const [formStatus, setFormStatus] = useState<SeasoningStatus>('sufficient');
  const [formError, setFormError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null); // 编辑模式：正在编辑的项 ID

  const filteredIngredients = useMemo(() => {
    const search = searchText.toLowerCase();
    return state.ingredients.filter((i) => i.name.toLowerCase().includes(search));
  }, [state.ingredients, searchText]);

  const filteredSeasonings = useMemo(() => {
    const search = searchText.toLowerCase();
    return state.seasonings.filter((s) => s.name.toLowerCase().includes(search));
  }, [state.seasonings, searchText]);

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

    // 编辑模式：不检查重名（名称可能不变）
    if (!editId) {
      const existingNames = activeTab === 'ingredients'
        ? state.ingredients.map((i) => i.name)
        : state.seasonings.map((s) => s.name);
      if (existingNames.includes(name)) {
        setFormError('该名称已存在');
        return;
      }
    }

    setFormError(null);

    if (activeTab === 'ingredients') {
      const weight = formWeight.trim() ? parseFloat(formWeight) : null;
      if (weight !== null && (isNaN(weight) || weight <= 0 || weight > 50000 || !Number.isInteger(weight))) {
        setFormError('请输入有效的重量 (1-50000的整数)');
        return;
      }
      if (editId) {
        await updateIngredient(editId, { name, weight });
      } else {
        await addIngredient(name, weight);
      }
    } else {
      if (editId) {
        await updateSeasoning(editId, { name, status: formStatus });
      } else {
        await addSeasoning(name, formStatus);
      }
    }

    resetForm();
  }, [formName, formWeight, formStatus, activeTab, editId, addIngredient, updateIngredient, addSeasoning, updateSeasoning, state.ingredients, state.seasonings]);

  const resetForm = useCallback(() => {
    setFormName('');
    setFormWeight('');
    setFormStatus('sufficient');
    setFormError(null);
    setEditId(null);
    setShowForm(false);
  }, []);

  // 点击列表项进入编辑模式
  const handleEditIngredient = useCallback((item: Ingredient) => {
    setEditId(item.id);
    setFormName(item.name);
    setFormWeight(item.weight !== null ? String(item.weight) : '');
    setShowForm(true);
  }, []);

  const handleEditSeasoning = useCallback((item: Seasoning) => {
    setEditId(item.id);
    setFormName(item.name);
    setFormStatus(item.status);
    setShowForm(true);
  }, []);

  const handleDelete = useCallback((id: string, name: string) => {
    Alert.alert('确认删除', `确定要删除"${name}"吗？此操作不可恢复。`, [
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
    ]);
  }, [activeTab, deleteIngredient, deleteSeasoning]);

  const renderIngredientItem = ({ item }: { item: Ingredient }) => (
    <TouchableOpacity style={styles.listItem} onPress={() => handleEditIngredient(item)} activeOpacity={0.7}>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemMeta}>
          {item.weight !== null ? `${item.weight} 克` : '未称量'} · 已存 {getDaysSince(item.createDate)} 天
        </Text>
      </View>
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>库存</Text>
      </View>

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
      ) : (
        <FlatList
          data={currentList}
          keyExtractor={(item) => item.id}
          renderItem={activeTab === 'ingredients' ? renderIngredientItem : renderSeasoningItem}
          contentContainerStyle={styles.list}
        />
      )}

      {showForm && (
        <View style={styles.formOverlay}>
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
              <TextInput
                style={styles.formInput}
                placeholder="重量（克，可留空）"
                placeholderTextColor={COLORS.textTertiary}
                value={formWeight}
                onChangeText={(t) => setFormWeight(t.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
              />
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

      {!showForm && <FAB icon="＋" onPress={() => setShowForm(true)} accessibilityLabel="添加" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface },
  headerTitle: { fontSize: TYPOGRAPHY.h1, fontWeight: '700', color: COLORS.textPrimary },
  tabRow: { flexDirection: 'row', paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm, backgroundColor: COLORS.surface },
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
});
