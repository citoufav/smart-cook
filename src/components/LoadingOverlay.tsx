import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Modal, TouchableOpacity, ScrollView, useWindowDimensions } from 'react-native';
import { COLORS } from '../constants/colors';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { cleanThinkingText } from '../utils/thinkingCleaner';

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
  thinkingText?: string;
  isStalled?: boolean;
  onRetry?: () => void;
}

export function LoadingOverlay({
  visible,
  message,
  thinkingText,
  isStalled,
  onRetry,
}: LoadingOverlayProps) {
  const { width: screenWidth } = useWindowDimensions();

  if (!visible) return null;

  const cleanText = thinkingText ? cleanThinkingText(thinkingText) : '';
  const cardWidth = Math.min(screenWidth * 0.88, 400);

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.card, { width: cardWidth }]}>
          <ActivityIndicator size="large" color={COLORS.primary} />

          <Text style={styles.thinkingLabel}>AI 深度思考中...</Text>

          <View style={styles.thinkingWindow}>
            <ScrollView
              style={styles.thinkingScroll}
              nestedScrollEnabled
              ref={(ref) => {
                if (ref) {
                  setTimeout(() => ref.scrollToEnd?.({ animated: false }), 50);
                }
              }}
            >
              {cleanText ? (
                <Text style={styles.thinkingDetail}>{cleanText}</Text>
              ) : (
                <Text style={styles.thinkingPlaceholder}>等待 AI 响应...</Text>
              )}
            </ScrollView>
          </View>

          {isStalled && (
            <View style={styles.stallBanner}>
              <Text style={styles.stallText}>AI 思考时间较长</Text>
              {onRetry && (
                <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.7}>
                  <Text style={styles.retryText}>重试</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
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
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.xl,
    alignItems: 'center',
    maxHeight: '80%',
  },
  thinkingLabel: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
    marginTop: SPACING.md,
  },
  // 底部思考细节窗口
  thinkingWindow: {
    width: '100%',
    height: 150,
    marginTop: SPACING.md,
    backgroundColor: '#F8F9FA',
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    padding: SPACING.sm,
  },
  thinkingScroll: {
    flex: 1,
  },
  thinkingDetail: {
    fontSize: 11,
    color: '#999',
    lineHeight: 16,
  },
  thinkingPlaceholder: {
    fontSize: 11,
    color: '#CCC',
    lineHeight: 16,
    fontStyle: 'italic',
  },
  // 卡顿提示
  stallBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: '#FFF8E1',
    borderRadius: BORDER_RADIUS.sm,
    width: '100%',
  },
  stallText: {
    fontSize: 12,
    color: COLORS.warningText,
    flex: 1,
  },
  retryBtn: {
    backgroundColor: COLORS.warning,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  retryText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
});
