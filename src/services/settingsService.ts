import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS, SECURE_STORE_KEY } from '../constants/storageKeys';
import { UserPreferences } from '../types';
import { safeGetJSON } from './storageService';
import { logger } from '../utils/logger';

const log = logger('SVC:SETTINGS');

export const DEFAULT_USER_PREFERENCES: Omit<UserPreferences, 'apiKey'> = {
  apiType: 'deepseek',
  apiUrl: 'https://api.deepseek.com',
  modelName: 'deepseek-v4-pro',
  dietaryRestrictions: [],
  tastePreferences: [],
  onboardingDone: false,
  locale: 'zh-CN',
  cuisineIds: [],
  thinkingEnabled: false,
  reasoningEffort: 'high',
};

export async function saveApiKey(apiKey: string): Promise<void> {
  try {
    if (apiKey) {
      await SecureStore.setItemAsync(SECURE_STORE_KEY, apiKey);
    } else {
      await SecureStore.deleteItemAsync(SECURE_STORE_KEY);
    }
  } catch (e) {
    log.warn('SecureStore 不可用，回退 AsyncStorage', String(e));
    if (apiKey) {
      await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS_API_KEY_FALLBACK, apiKey);
    } else {
      await AsyncStorage.removeItem(STORAGE_KEYS.SETTINGS_API_KEY_FALLBACK);
    }
  }
}

export async function getApiKey(): Promise<string> {
  try {
    const key = await SecureStore.getItemAsync(SECURE_STORE_KEY);
    if (key) return key;
  } catch (e) {
    log.warn('SecureStore 读取失败，回退 AsyncStorage', String(e));
  }
  const fallback = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS_API_KEY_FALLBACK);
  return fallback || '';
}

export async function loadNonSensitiveSettings(): Promise<Omit<UserPreferences, 'apiKey'>> {
  const saved = await safeGetJSON<Partial<UserPreferences>>(STORAGE_KEYS.SETTINGS_PREFERENCES, {});
  return {
    ...DEFAULT_USER_PREFERENCES,
    ...saved,
    // Users who already had a saved preferences blob predate onboarding: don't show it to them again.
    onboardingDone: saved.onboardingDone ?? saved.apiType !== undefined,
  };
}

export async function saveNonSensitiveSettings(prefs: Omit<UserPreferences, 'apiKey'>): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS_PREFERENCES, JSON.stringify(prefs));
}

export async function loadFullPreferences(): Promise<UserPreferences> {
  const [nonSensitive, apiKey] = await Promise.all([
    loadNonSensitiveSettings(),
    getApiKey(),
  ]);
  return { ...nonSensitive, apiKey };
}
