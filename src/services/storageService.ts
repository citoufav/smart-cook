import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';

const log = logger('SVC:STORAGE');

export interface StorageResult<T> {
  success: boolean;
  data?: T | null;
  error?: string;
}

export const storageService = {
  async get<T>(key: string): Promise<StorageResult<T>> {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw === null) return { success: true, data: null };
      const data = JSON.parse(raw) as T;
      return { success: true, data };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async set<T>(key: string, value: T): Promise<StorageResult<void>> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async remove(key: string): Promise<StorageResult<void>> {
    try {
      await AsyncStorage.removeItem(key);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getAllKeys(prefix: string): Promise<string[]> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      return allKeys.filter((k) => k.startsWith(prefix));
    } catch {
      return [];
    }
  },

  async multiGet(keys: string[]): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    try {
      const pairs = await AsyncStorage.multiGet(keys);
      // 逐 key 容错：单个 key 数据损坏不应影响其余 key
      for (const [key, value] of pairs) {
        try {
          result[key] = value ? JSON.parse(value) : null;
        } catch {
          result[key] = null;
        }
      }
      return result;
    } catch {
      return result;
    }
  },
};

export async function safeGetJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    log.warn(`safeGetJSON: 数据损坏，使用默认值: ${key}`);
    try {
      const corruptedRaw = await AsyncStorage.getItem(key);
      if (corruptedRaw) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await AsyncStorage.setItem(`${key}_corrupted_${timestamp}`, corruptedRaw);
      }
    } catch {}
    await AsyncStorage.setItem(key, JSON.stringify(fallback));
    return fallback;
  }
}
