import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Button } from './Button';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 全局错误边界：捕获子树渲染期错误，展示可重试的错误页，避免整页白屏。
 * 用法：包在 provider 栈最外层（见 app/_layout.tsx）。
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 错误始终输出到控制台（含 release 包），便于排查
    console.error('[ERROR_BOUNDARY]', error.message, info.componentStack || '');
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>🍳</Text>
        <Text style={styles.title}>页面出了点问题</Text>
        <Text style={styles.message}>
          应用遇到意外错误。点击「重试」恢复；若反复出现，请重启应用。
        </Text>
        <ScrollView style={styles.detailBox} nestedScrollEnabled>
          <Text style={styles.detailText}>
            {this.state.error?.message || String(this.state.error)}
          </Text>
        </ScrollView>
        <View style={styles.actions}>
          <Button title="重试" variant="primary" onPress={this.handleReset} />
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  emoji: { fontSize: 48, marginBottom: SPACING.md },
  title: {
    fontSize: TYPOGRAPHY.h3,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  message: {
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.lg,
  },
  detailBox: {
    maxHeight: 120,
    alignSelf: 'stretch',
    backgroundColor: COLORS.neutralLight,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  detailText: { fontSize: TYPOGRAPHY.caption, color: COLORS.danger },
  actions: { alignSelf: 'stretch' },
});

export default ErrorBoundary;
