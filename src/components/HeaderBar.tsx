import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS, SHADOWS } from '../constants/spacing';

interface HeaderBarProps {
  title: string;
  onOpenDrawer: () => void;
}

const AVATAR_MENU_ITEMS = [
  { icon: 'camera-outline', label: '修改头像' },
  { icon: 'create-outline', label: '修改昵称' },
  { icon: 'lock-closed-outline', label: '修改密码' },
  { icon: 'log-out-outline', label: '退出登录' },
] as const;

export default function HeaderBar({ title, onOpenDrawer }: HeaderBarProps) {
  const insets = useSafeAreaInsets();
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);

  return (
    <>
      {/* 安全区填充 */}
      <View style={[styles.safeTop, { height: insets.top }]} />
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onOpenDrawer} hitSlop={12}>
          <Ionicons name="menu-outline" size={30} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={() => setShowAvatarMenu(!showAvatarMenu)} hitSlop={12}>
          <Ionicons name="person-circle-outline" size={34} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* 头像下拉菜单 */}
      {showAvatarMenu && (
        <View style={styles.avatarDropdown}>
          {AVATAR_MENU_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.dropdownItem}
              onPress={() => setShowAvatarMenu(false)}
              activeOpacity={0.7}
            >
              <Ionicons name={item.icon} size={18} color={COLORS.textSecondary} />
              <Text style={styles.dropdownLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  safeTop: { backgroundColor: COLORS.surface },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
  },
  title: {
    fontSize: TYPOGRAPHY.h1,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  avatarDropdown: {
    position: 'absolute',
    right: SPACING.lg,
    top: 100, // safeTop + headerRow height approximation
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.xs,
    minWidth: 160,
    zIndex: 200,
    ...SHADOWS.md,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
  },
  dropdownLabel: {
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
  },
});
