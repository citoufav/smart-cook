import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo, useRef } from 'react';
import { SettingsState, UserPreferences } from '../types';
import { loadFullPreferences, saveApiKey, saveNonSensitiveSettings, DEFAULT_USER_PREFERENCES } from '../services/settingsService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { logger } from '../utils/logger';

type SettingsAction =
  | { type: 'LOAD_PREFERENCES'; payload: UserPreferences }
  | { type: 'UPDATE_PREFERENCES'; payload: Partial<UserPreferences> }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

const log = logger('CTX:SETTINGS');

const INITIAL_STATE: SettingsState = {
  preferences: { ...DEFAULT_USER_PREFERENCES, apiKey: '' },
  isLoading: true,
  error: null,
};

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'LOAD_PREFERENCES':
      log.info('LOAD_PREFERENCES', { modelName: action.payload.modelName, thinkingEnabled: action.payload.thinkingEnabled });
      return { ...state, preferences: action.payload, isLoading: false };
    case 'UPDATE_PREFERENCES':
      log.debug('UPDATE_PREFERENCES', Object.keys(action.payload));
      if (action.payload.apiKey) {
        log.info('API Key configured');
      }
      if (action.payload.modelName) {
        log.info('Model changed', { modelName: action.payload.modelName });
      }
      if (action.payload.thinkingEnabled !== undefined) {
        log.info('Thinking changed', { thinkingEnabled: action.payload.thinkingEnabled });
      }
      return {
        ...state,
        preferences: { ...state.preferences, ...action.payload },
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      log.error('SET_ERROR', { error: action.payload });
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
  saveLastCookingDefaults: (data: { people?: number; personCount: number; mealType: string; calorieTarget?: number; caloriePreference?: number; customPeople?: number | null; customMealType?: string; customCalorie?: number | null }) => Promise<void>;
  loadLastCookingDefaults: () => Promise<{ people?: number; personCount: number; mealType: string; calorieTarget?: number; caloriePreference?: number; customPeople?: number | null; customMealType?: string; customCalorie?: number | null } | null>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(settingsReducer, INITIAL_STATE);

  /**
   * 最新的 preferences 镜像。
   * updatePreferences 曾经用 `state.preferences` 合并，闭包里拿到的是"上一次渲染"的值：
   * 连续点两个开关时，后一次写入会用旧快照覆盖前一次的结果（看似"设置没记住"）。
   * 用 ref 同步写入，连续调用也能正确叠加。
   */
  const prefsRef = useRef(state.preferences);
  useEffect(() => {
    prefsRef.current = state.preferences;
  }, [state.preferences]);

  useEffect(() => {
    (async () => {
      try {
        log.info('Loading preferences from storage...');
        const prefs = await loadFullPreferences();
        log.info('Preferences loaded', { modelName: prefs.modelName });
        dispatch({ type: 'LOAD_PREFERENCES', payload: prefs });
      } catch (e: any) {
        log.error('Failed to load preferences', { error: String(e) });
        dispatch({ type: 'SET_ERROR', payload: String(e) });
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    })();
  }, []);

  const updateApiKey = useCallback(async (key: string) => {
    log.info('updateApiKey called (key content redacted)');
    await saveApiKey(key);
    dispatch({ type: 'UPDATE_PREFERENCES', payload: { apiKey: key } as any });
  }, []);

  const updatePreferences = useCallback(async (prefs: Partial<UserPreferences>) => {
    log.debug('updatePreferences called', Object.keys(prefs));
    dispatch({ type: 'UPDATE_PREFERENCES', payload: prefs });
    const merged = { ...prefsRef.current, ...prefs };
    prefsRef.current = merged;
    const { apiKey: _apiKey, ...nonSensitive } = merged;
    void _apiKey;
    try {
      await saveNonSensitiveSettings(nonSensitive);
    } catch (e) {
      // 写盘失败不能让界面卡住，但必须留痕，否则"设置又变回默认"永远查不到原因
      log.error('保存设置失败', String(e));
    }
  }, []);

  const saveLastCookingDefaults = useCallback(async (data: {
    people?: number;
    personCount: number;
    mealType: string;
    calorieTarget?: number;
    caloriePreference?: number;
    customPeople?: number | null;
    customMealType?: string;
    customCalorie?: number | null;
  }) => {
    log.debug('saveLastCookingDefaults', {
      hasPeople: data.people !== undefined,
      people: data.people,
      personCount: data.personCount,
      mealType: data.mealType,
      calorieTarget: data.calorieTarget,
      hasCustom: data.customPeople !== undefined && data.customPeople !== null,
    });
    await AsyncStorage.setItem(STORAGE_KEYS.COOKING_INPUT_DEFAULTS, JSON.stringify(data));
  }, []);

  const loadLastCookingDefaults = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.COOKING_INPUT_DEFAULTS);
      if (raw) {
        const parsed = JSON.parse(raw);
        log.info('loadLastCookingDefaults', { personCount: parsed.personCount, mealType: parsed.mealType, hasCustom: parsed.customPeople !== undefined && parsed.customPeople !== null });
        return parsed;
      }
      log.info('loadLastCookingDefaults: no saved defaults');
      return null;
    } catch {
      log.warn('loadLastCookingDefaults: failed to parse saved defaults');
      return null;
    }
  }, []);

  const value = useMemo(
    () => ({ state, dispatch, updateApiKey, updatePreferences, saveLastCookingDefaults, loadLastCookingDefaults }),
    [state, dispatch, updateApiKey, updatePreferences, saveLastCookingDefaults, loadLastCookingDefaults],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
