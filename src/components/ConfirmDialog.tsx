import React from 'react';
import { View, Text, Modal, StyleSheet } from 'react-native';
import { Button } from './Button';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING } from '../constants/spacing';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  confirmVariant,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const variant = confirmVariant || (destructive ? 'danger' : 'primary');

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.buttons}>
            <Button title={cancelLabel} variant="ghost" onPress={onCancel} style={styles.cancelBtn} />
            <Button title={confirmLabel} variant={variant} onPress={onConfirm} style={styles.confirmBtn} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xxxl,
  },
  dialog: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.xxl,
    width: '100%',
    maxWidth: 340,
  },
  title: {
    fontSize: TYPOGRAPHY.h3,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  message: {
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textBody,
    lineHeight: 22,
    marginBottom: SPACING.xl,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.md,
  },
  cancelBtn: {
    flex: 1,
  },
  confirmBtn: {
    flex: 1,
  },
});
