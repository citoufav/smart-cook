import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCooking } from '../../src/contexts/CookingContext';
import { useNutrition } from '../../src/contexts/NutritionContext';
import { COLORS } from '../../src/constants/colors';
import { TYPOGRAPHY } from '../../src/constants/typography';
import CookingPager from '../../src/components/CookingPager';
import { Button } from '../../src/components/Button';

export default function CookingPagerScreen() {
  const { state } = useCooking();
  const nutrition = useNutrition();
  const params = useLocalSearchParams<{ historyMode?: string; initialStage?: string }>();
  const historyMode = params.historyMode === '1';

  // 确保悬浮球在菜谱页面可见
  React.useEffect(() => {
    if (nutrition.state.totalNutrition && nutrition.state.totalNutrition.calories > 0 && !nutrition.state.isVisible) {
      nutrition.dispatch({ type: 'SHOW_BALL' as any });
    }
  }, []);

  if (!state.session) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>暂无做菜数据</Text>
        <Button title="返回首页" variant="ghost" onPress={() => router.replace('/(tabs)/cooking')} />
      </View>
    );
  }

  return (
    <CookingPager
      initialStage={params.initialStage}
      historyMode={historyMode}
    />
  );
}

const styles = StyleSheet.create({
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background },
  emptyText: { fontSize: TYPOGRAPHY.body, color: COLORS.textSecondary, marginBottom: 16 },
});
