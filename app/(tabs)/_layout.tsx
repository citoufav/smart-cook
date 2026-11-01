import React from 'react';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/colors';

const TAB_ICONS: Record<string, { focused: string; unfocused: string }> = {
  inventory: { focused: 'cube', unfocused: 'cube-outline' },
  dishes: { focused: 'book', unfocused: 'book-outline' },
  restaurant: { focused: 'restaurant', unfocused: 'restaurant-outline' },
};

function TabIcon({ name, color, size, focused }: { name: string; color: string; size: number; focused: boolean }) {
  const icons = TAB_ICONS[name];
  if (!icons) return <Ionicons name="help-circle-outline" size={size} color={color} />;
  return <Ionicons name={focused ? icons.focused as any : icons.unfocused as any} size={size} color={color} />;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarStyle: {
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: '#FFFFFF',
          borderTopColor: COLORS.border,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '库存',
          tabBarIcon: ({ color, size, focused }) => <TabIcon name="inventory" color={color} size={size} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="dishes"
        options={{
          title: '我的菜',
          tabBarIcon: ({ color, size, focused }) => <TabIcon name="dishes" color={color} size={size} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="cooking"
        options={{
          title: '做菜',
          tabBarIcon: ({ color, size, focused }) => <TabIcon name="restaurant" color={color} size={size} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
