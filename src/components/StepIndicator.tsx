import React, { useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { STEP_WIDTH } from '../constants/cooking';

interface StepItem {
  label: string;
  status: 'completed' | 'current' | 'pending';
}

interface StepIndicatorProps {
  steps: StepItem[];
  currentIndex: number;
  onStepPress?: (index: number) => void;
}

export function StepIndicator({ steps, currentIndex, onStepPress }: StepIndicatorProps) {
  const scrollRef = useRef<ScrollView>(null);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {steps.map((step, index) => {
        const isCompleted = step.status === 'completed';
        const isCurrent = step.status === 'current';
        const isPast = index < currentIndex;

        return (
          <View key={index} style={styles.stepWrapper}>
            {index > 0 && (
              <View
                style={[
                  styles.connector,
                  isPast ? styles.connectorCompleted : styles.connectorPending,
                ]}
              />
            )}
            <TouchableOpacity
              style={[
                styles.node,
                isCompleted && styles.nodeCompleted,
                isCurrent && styles.nodeCurrent,
              ]}
              disabled={!isPast || !onStepPress}
              onPress={() => onStepPress?.(index)}
              activeOpacity={0.6}
            >
              <Text
                style={[
                  styles.nodeText,
                  isCompleted && styles.nodeTextCompleted,
                  isCurrent && styles.nodeTextCurrent,
                ]}
              >
                {isCompleted ? '✓' : String(index + 1)}
              </Text>
            </TouchableOpacity>
            <Text
              style={[
                styles.label,
                isCompleted && styles.labelCompleted,
                isCurrent && styles.labelCurrent,
              ]}
            >
              {step.label}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  stepWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    width: STEP_WIDTH,
  },
  connector: {
    width: 12,
    height: 2,
  },
  connectorCompleted: {
    backgroundColor: COLORS.primary,
  },
  connectorPending: {
    backgroundColor: COLORS.border,
  },
  node: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  nodeCompleted: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  nodeCurrent: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surface,
  },
  nodeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textTertiary,
  },
  nodeTextCompleted: {
    color: COLORS.textWhite,
  },
  nodeTextCurrent: {
    color: COLORS.primary,
  },
  label: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 4,
    textAlign: 'center',
  },
  labelCompleted: {
    color: COLORS.textSecondary,
  },
  labelCurrent: {
    color: COLORS.primary,
    fontWeight: '600',
  },
});
