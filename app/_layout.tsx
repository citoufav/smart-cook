import React from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SettingsProvider } from '../src/contexts/SettingsContext';
import { InventoryProvider } from '../src/contexts/InventoryContext';
import { CookingProvider } from '../src/contexts/CookingContext';
import { NutritionProvider } from '../src/contexts/NutritionContext';
import { FloatingBall } from '../src/components/FloatingBall';
import { NutritionBottomSheet } from '../src/components/NutritionBottomSheet';

// 禁用字体缩放
(Text as any).defaultProps = (Text as any).defaultProps || {};
(Text as any).defaultProps.allowFontScaling = false;
(TextInput as any).defaultProps = (TextInput as any).defaultProps || {};
(TextInput as any).defaultProps.allowFontScaling = false;

function AppContent() {
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="history"
          options={{
            headerShown: true,
            presentation: 'modal',
          }}
        />
      </Stack>
      <FloatingBall />
      <NutritionBottomSheet />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <InventoryProvider>
          <CookingProvider>
            <NutritionProvider>
              <AppContent />
            </NutritionProvider>
          </CookingProvider>
        </InventoryProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
