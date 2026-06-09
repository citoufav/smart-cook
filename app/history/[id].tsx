import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import { SPACING, BORDER_RADIUS } from '../../src/constants/spacing';
import { Card } from '../../src/components/Card';
import { menuHistoryService, MenuHistoryItem } from '../../src/services/menuHistoryService';

export default function HistoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<MenuHistoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReasoning, setShowReasoning] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const data = await menuHistoryService.getById(id);
      setItem(data);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFound}>记录不存在</Text>
      </View>
    );
  }

  const menu = item.menuProposal;
  const dishes = menu?.dishes || [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* 基本信息 */}
      <Card title={item.name}>
        <Text style={styles.meta}>
          生成时间：{new Date(item.createdAt).toLocaleString('zh-CN')}
        </Text>
        {item.requirement && (
          <Text style={styles.meta}>
            {item.requirement.personCount}人 · {item.requirement.mealType}
            {item.requirement.caloriePreference ? ` · ${item.requirement.caloriePreference}大卡` : ''}
            {item.requirement.customRequirement ? ` · ${item.requirement.customRequirement}` : ''}
          </Text>
        )}
      </Card>

      {/* 菜品列表 */}
      {dishes.length > 0 && (
        <Card title={`菜品（${dishes.length} 道）`}>
          {dishes.map((dish: any, idx: number) => (
            <View key={idx} style={styles.dishBlock}>
              <Text style={styles.dishName}>{idx + 1}. {dish.name}</Text>
              <View style={styles.ingredientRow}>
                {dish.ingredients?.map((ing: any) => (
                  <Text key={ing.name} style={styles.ingredient}>
                    {ing.name} {ing.estimatedWeight}g
                  </Text>
                ))}
              </View>
              {dish.estimatedNutrition && (
                <Text style={styles.nutritionText}>
                  {dish.estimatedNutrition.calories}大卡 | 蛋白{dish.estimatedNutrition.protein}g | 脂肪{dish.estimatedNutrition.fat}g | 碳水{dish.estimatedNutrition.carbs}g
                </Text>
              )}
            </View>
          ))}
        </Card>
      )}

      {/* AI 摘要 */}
      {menu?.summary?.description && (
        <Card title="AI 摘要">
          <Text style={styles.summaryText}>{menu.summary.description}</Text>
        </Card>
      )}

      {/* 思维链 */}
      {item.reasoningContent ? (
        <TouchableOpacity
          style={styles.reasoningHeader}
          onPress={() => setShowReasoning(!showReasoning)}
        >
          <Text style={styles.reasoningTitle}>
            {showReasoning ? '▼' : '▶'} AI 思考过程
          </Text>
          <Text style={styles.reasoningHint}>点击{showReasoning ? '收起' : '展开'}</Text>
        </TouchableOpacity>
      ) : null}
      {showReasoning && item.reasoningContent && (
        <View style={styles.reasoningContent}>
          <Text style={styles.reasoningText}>{item.reasoningContent}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: SPACING.lg, paddingBottom: 100 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFound: { fontSize: TYPOGRAPHY.body, color: COLORS.textSecondary },
  meta: { fontSize: TYPOGRAPHY.caption, color: COLORS.textSecondary, marginBottom: 2 },
  dishBlock: {
    backgroundColor: COLORS.neutralLight,
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  dishName: { fontSize: TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 4 },
  ingredientRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ingredient: { fontSize: 12, color: COLORS.textSecondary },
  nutritionText: { fontSize: 11, color: COLORS.textTertiary, marginTop: 4 },
  summaryText: { fontSize: TYPOGRAPHY.bodySmall, color: COLORS.textBody, lineHeight: 20 },
  reasoningHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F0F4FF',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  reasoningTitle: { fontSize: TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.primary },
  reasoningHint: { fontSize: 11, color: COLORS.textTertiary },
  reasoningContent: {
    backgroundColor: '#F8F9FA',
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.md,
    marginTop: SPACING.xs,
  },
  reasoningText: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
});
