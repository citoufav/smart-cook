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
  modelName: 'deepseek-flash',
  dietaryRestrictions: [],
  tastePreferences: [],
  onboardingDone: false,
  locale: 'zh-CN',
  cuisineIds: [],
  // 思考模式界面已撤掉，这里只作为默认值留着（aiClient 现在写死"生成菜单时开"）
  thinkingEnabled: true,
  reasoningEffort: 'high',
  cookingSkill: 'beginner',
  // 调试用：true = 每次启动都进引导页。发布前确认这里是 false
  forceOnboarding: false,
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
