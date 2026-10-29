import React, { createContext, useContext, useState, useMemo } from 'react';
import SettingsDrawer from '../components/SettingsDrawer';

interface SettingsDrawerContextValue {
  openSettings: () => void;
  closeSettings: () => void;
}

const SettingsDrawerContext = createContext<SettingsDrawerContextValue>({
  openSettings: () => {},
  closeSettings: () => {},
});

export function useSettingsDrawer() {
  return useContext(SettingsDrawerContext);
}

export function SettingsDrawerProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);

  const value = useMemo(
    () => ({
      openSettings: () => setVisible(true),
      closeSettings: () => setVisible(false),
    }),
    [],
  );

  return (
    <SettingsDrawerContext.Provider value={value}>
      {children}
      <SettingsDrawer visible={visible} onClose={() => setVisible(false)} />
    </SettingsDrawerContext.Provider>
  );
}
