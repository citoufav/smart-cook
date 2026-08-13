import React, { createContext, useContext, useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';

interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface AlertConfig {
  title: string;
  message: string;
  buttons?: AlertButton[];
}

interface CustomAlertContextValue {
  showAlert: (config: AlertConfig) => void;
}

const CustomAlertContext = createContext<CustomAlertContextValue>({
  showAlert: () => {},
});

export function useCustomAlert() {
  return useContext(CustomAlertContext);
}

export function CustomAlertProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<AlertConfig>({ title: '', message: '' });

  const showAlert = useCallback((cfg: AlertConfig) => {
    setConfig(cfg);
    setVisible(true);
  }, []);

  const handlePress = useCallback(
    (btn: AlertButton) => {
      setVisible(false);
      btn.onPress?.();
    },
    [],
  );

  const buttons = config.buttons?.length
    ? config.buttons
    : [{ text: '确定', style: 'default' as const }];

  return (
    <CustomAlertContext.Provider value={{ showAlert }}>
      {children}
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.title}>{config.title}</Text>
            <Text style={styles.message}>{config.message}</Text>
            <View style={styles.btnRow}>
              {buttons.map((btn, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.btn,
                    btn.style === 'cancel' && styles.btnCancel,
                    btn.style === 'destructive' && styles.btnDestructive,
                  ]}
                  onPress={() => handlePress(btn)}
                >
                  <Text
                    style={[
                      styles.btnText,
                      btn.style === 'destructive' && styles.btnTextDestructive,
                      btn.style === 'cancel' && styles.btnTextCancel,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </CustomAlertContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xxl,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xxl,
    width: '100%',
    maxWidth: 320,
  },
  title: {
    fontSize: TYPOGRAPHY.h4,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  message: {
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  btnCancel: {
    backgroundColor: COLORS.neutralLight,
  },
  btnDestructive: {
    backgroundColor: '#FF4444',
  },
  btnText: {
    fontSize: TYPOGRAPHY.bodySmall,
    fontWeight: '600',
    color: COLORS.textWhite,
  },
  btnTextDestructive: {
    color: COLORS.textWhite,
  },
  btnTextCancel: {
    color: COLORS.textSecondary,
  },
});
