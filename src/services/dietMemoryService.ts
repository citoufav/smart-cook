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

/** Get the dish names of the most recent N meals (newest first) */
export async function getRecentMeals(limit: number = 3): Promise<string[]> {
  const all = await getAll();
  return all.slice(0, limit).map((e) => e.name);
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
