import React from 'react';
import { Stack } from 'expo-router';

export default function HistoryLayout() {
  return (
    <Stack
      screenOptions={{
        headerTitleStyle: { fontSize: 17, fontWeight: '600' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: '历史会话' }} />
      <Stack.Screen name="[id]" options={{ title: '会话详情' }} />
    </Stack>
  );
}
