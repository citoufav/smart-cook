import React, { createContext, useContext, useState } from 'react';
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

  return (
    <SettingsDrawerContext.Provider
      value={{ openSettings: () => setVisible(true), closeSettings: () => setVisible(false) }}
    >
      {children}
      <SettingsDrawer visible={visible} onClose={() => setVisible(false)} />
    </SettingsDrawerContext.Provider>
  );
}
