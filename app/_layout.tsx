import React from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SettingsProvider, useSettings } from '../src/contexts/SettingsContext';
import { InventoryProvider } from '../src/contexts/InventoryContext';
import { CookingProvider } from '../src/contexts/CookingContext';
import { NutritionProvider } from '../src/contexts/NutritionContext';
import { SettingsDrawerProvider } from '../src/contexts/SettingsDrawerContext';
import { ChatBallProvider, useChatBall } from '../src/contexts/ChatBallContext';
import { ChatSheetProvider, useChatSheet } from '../src/contexts/ChatSheetContext';
import { MenuHistoryProvider } from '../src/contexts/MenuHistoryContext';
import { FloatingBall } from '../src/components/FloatingBall';
import { ChatBall } from '../src/components/ChatBall';
import ChatSheet from '../src/components/ChatSheet';
import { NutritionBottomSheet } from '../src/components/NutritionBottomSheet';
import { CustomAlertProvider } from '../src/components/CustomAlert';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

// Disable font scaling
// 注：React 19 移除了函数组件的 defaultProps 支持，RN 0.81 新架构下此补丁可能不生效。
// 此前曾尝试包装 jsx/jsxDEV 运行时注入默认 props，但 Metro 的 ESM 命名空间属性只读，
// 模块加载期赋值直接抛 TypeError 导致启动闪退（dev 与打包均崩），已回退为此写法。
// 如确需禁用系统字体缩放，后续应迁移为自定义 Text 组件封装（AppText）。
(Text as any).defaultProps = (Text as any).defaultProps || {};
(Text as any).defaultProps.allowFontScaling = false;
(TextInput as any).defaultProps = (TextInput as any).defaultProps || {};
(TextInput as any).defaultProps.allowFontScaling = false;

function AppContent() {
  const { visible: chatSheetVisible, recipeContext, hideChatSheet } = useChatSheet();
  const { state: settingsState } = useSettings();
  const onboardingDone = settingsState.preferences.onboardingDone;

  // First launch: send to the quick-record screen once preferences have loaded,
  // so we never redirect an existing user whose data is still being read.
  React.useEffect(() => {
    if (!settingsState.isLoading && !onboardingDone) {
      router.replace('/onboard');
    }
  }, [settingsState.isLoading, onboardingDone]);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboard" />
        <Stack.Screen
          name="history"
          options={{
            headerShown: true,
            presentation: 'modal',
          }}
        />
      </Stack>
      <FloatingBallsLayer />
      <NutritionBottomSheet />
      {chatSheetVisible && recipeContext && (
        <ChatSheet
          visible={chatSheetVisible}
          onClose={hideChatSheet}
          recipeContext={recipeContext}
        />
      )}
    </View>
  );
}

function FloatingBallsLayer() {
  const { visible: chatVisible, onChatPress } = useChatBall();
  const nutritionBallRect = React.useRef<{ x: number; y: number; size: number } | null>(null);
  const chatBallRect = React.useRef<{ x: number; y: number; size: number } | null>(null);

  const updateRect = (
    ref: React.MutableRefObject<{ x: number; y: number; size: number } | null>,
    size: number,
  ) => (x: number, y: number) => {
    (ref as any).current = { x, y, size };
  };

  return (
    <>
      <FloatingBall
        otherBallRect={chatBallRect}
        onPositionUpdate={updateRect(nutritionBallRect, 56)}
      />
      <ChatBall
        visible={chatVisible}
        otherBallRect={nutritionBallRect}
        onPress={() => onChatPress?.()}
        onPositionUpdate={updateRect(chatBallRect, 56)}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <SettingsProvider>
          <InventoryProvider>
            <CookingProvider>
              <NutritionProvider>
                <CustomAlertProvider>
                  <ChatBallProvider>
                    <ChatSheetProvider>
                      <SettingsDrawerProvider>
                        <MenuHistoryProvider>
                          <AppContent />
                        </MenuHistoryProvider>
                      </SettingsDrawerProvider>
                    </ChatSheetProvider>
                  </ChatBallProvider>
                </CustomAlertProvider>
              </NutritionProvider>
            </CookingProvider>
          </InventoryProvider>
        </SettingsProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
