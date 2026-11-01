import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { isStapleDish } from '../utils/dishLibrary';

export interface DietEntry {
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

/**
 * Get the dish names of the most recent N meals (newest first)
 *
 * 主食滤掉：「最近吃过：米饭、胡萝卜洋葱豆腐炒蛋」这种读着很怪，
 * 而且它会以「请避免推荐与以上重复的菜品」进 AI 提示词 —— 那也不该挡着米饭。
 */
export async function getRecentMeals(limit: number = 3): Promise<string[]> {
  const all = await getAll();
  return all
    .map((e) => e.name)
    .filter((name) => name && !isStapleDish(name))
    .slice(0, limit);
}

/** Record the dish names of one meal (supports multiple names) */
export async function addMeals(mealNames: string[]): Promise<void> {
  const now = new Date().toISOString();
  const all = await getAll();
  const newEntries: DietEntry[] = mealNames.map((name) => ({
    name,
    timestamp: now,
  }));
  // Insert new entries at the front (newest first), truncate beyond MAX_ENTRIES
  const updated = [...newEntries, ...all].slice(0, MAX_ENTRIES);
  await saveAll(updated);
}

/** 备份导出用 */
export async function exportDietMemory(): Promise<DietEntry[]> {
  return getAll();
}

/** 备份导入用：合并后的整表写回 */
export async function replaceDietMemory(entries: DietEntry[]): Promise<void> {
  await saveAll(entries.slice(0, MAX_ENTRIES));
}

export const DIET_MEMORY_LIMIT = MAX_ENTRIES;
