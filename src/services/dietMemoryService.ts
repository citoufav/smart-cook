import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/storageKeys';

interface DietEntry {
  name: string;
  timestamp: string;
}

const MAX_ENTRIES = 10;

async function getAll(): Promise<DietEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.DIET_MEMORY);
    if (!raw) return [];
    return JSON.parse(raw) as DietEntry[];
  } catch {
    return [];
  }
}

async function saveAll(entries: DietEntry[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.DIET_MEMORY, JSON.stringify(entries));
}

/** 获取最近 N 顿菜名列表（最新的在前） */
export async function getRecentMeals(limit: number = 3): Promise<string[]> {
  const all = await getAll();
  return all.slice(0, limit).map((e) => e.name);
}

/** 记录一顿饭的菜名（支持传入多个菜名） */
export async function addMeals(mealNames: string[]): Promise<void> {
  const now = new Date().toISOString();
  const all = await getAll();
  const newEntries: DietEntry[] = mealNames.map((name) => ({
    name,
    timestamp: now,
  }));
  // 新记录插入到最前面（最新的在前），超出 MAX_ENTRIES 的截掉
  const updated = [...newEntries, ...all].slice(0, MAX_ENTRIES);
  await saveAll(updated);
}
