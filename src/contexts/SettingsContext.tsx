import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { SettingsState, UserPreferences, ApiType } from '../types';
import { loadFullPreferences, saveApiKey, saveNonSensitiveSettings, DEFAULT_USER_PREFERENCES } from '../services/settingsService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/storageKeys';

type SettingsAction =
  | { type: 'LOAD_PREFERENCES'; payload: UserPreferences }
  | { type: 'UPDATE_PREFERENCES'; payload: Partial<UserPreferences> }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

const INITIAL_STATE: SettingsState = {
  preferences: { ...DEFAULT_USER_PREFERENCES, apiKey: '' },
  isLoading: true,
  error: null,
};

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'LOAD_PREFERENCES':
      return { ...state, preferences: action.payload, isLoading: false };
    case 'UPDATE_PREFERENCES':
      return {
        ...state,
        preferences: { ...state.preferences, ...action.payload },
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    default:
      return state;
  }
}

interface SettingsContextValue {
  state: SettingsState;
  dispatch: React.Dispatch<SettingsAction>;
  updateApiKey: (key: string) => Promise<void>;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
  saveLastCookingDefaults: (data: { personCount: number; mealType: string; caloriePreference?: number; customPeople?: number | null; customMealType?: string; customCalorie?: number | null }) => Promise<void>;
  loadLastCookingDefaults: () => Promise<{ personCount: number; mealType: string; caloriePreference?: number; customPeople?: number | null; customMealType?: string; customCalorie?: number | null } | null>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(settingsReducer, INITIAL_STATE);

  useEffect(() => {
    (async () => {
      try {
        const prefs = await loadFullPreferences();
        dispatch({ type: 'LOAD_PREFERENCES', payload: prefs });
      } catch (e: any) {
        dispatch({ type: 'SET_ERROR', payload: String(e) });
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    })();
  }, []);

  const updateApiKey = useCallback(async (key: string) => {
    await saveApiKey(key);
    dispatch({ type: 'UPDATE_PREFERENCES', payload: { apiKey: key } as any });
  }, []);

  const updatePreferences = useCallback(async (prefs: Partial<UserPreferences>) => {
    dispatch({ type: 'UPDATE_PREFERENCES', payload: prefs });
    const nonSensitive: any = { ...state.preferences, ...prefs };
    delete nonSensitive.apiKey;
    await saveNonSensitiveSettings(nonSensitive);
  }, [state.preferences]);

  const saveLastCookingDefaults = useCallback(async (data: { personCount: number; mealType: string; caloriePreference?: number }) => {
    await AsyncStorage.setItem(STORAGE_KEYS.COOKING_INPUT_DEFAULTS, JSON.stringify(data));
  }, []);

  const loadLastCookingDefaults = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.COOKING_INPUT_DEFAULTS);
      if (raw) return JSON.parse(raw);
      return null;
    } catch {
      return null;
    }
  }, []);

  return (
    <SettingsContext.Provider
      value={{ state, dispatch, updateApiKey, updatePreferences, saveLastCookingDefaults, loadLastCookingDefaults }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
