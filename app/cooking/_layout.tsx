import React from 'react';
import { Stack } from 'expo-router';

export default function CookingLayout() {
  return (
    <Stack
      screenOptions={({ route }) => {
        const params = (route.params as Record<string, string | undefined>) || {};
        const direction = params?.transitionDirection;
        return {
          animation: direction === 'backward' ? 'slide_from_left' : 'slide_from_right',
          headerBackTitle: '返回',
          headerTitleStyle: { fontSize: 17, fontWeight: '600' },
          headerShadowVisible: false,
        };
      }}
    >
      <Stack.Screen name="pager" options={{ headerShown: false }} />
      <Stack.Screen name="shopping-list" options={{ title: '采购清单' }} />
      <Stack.Screen name="inventory-update" options={{ title: '库存更新' }} />
    </Stack>
  );
}
