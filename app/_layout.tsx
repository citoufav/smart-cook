import React from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SettingsProvider } from '../src/contexts/SettingsContext';
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

// Disable font scaling
(Text as any).defaultProps = (Text as any).defaultProps || {};
(Text as any).defaultProps.allowFontScaling = false;
(TextInput as any).defaultProps = (TextInput as any).defaultProps || {};
(TextInput as any).defaultProps.allowFontScaling = false;

function AppContent() {
  const { visible: chatSheetVisible, recipeContext, hideChatSheet } = useChatSheet();
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
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
