import { storageService } from './storageService';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { Seasoning, SeasoningCreateInput } from '../types';
import { generateId } from '../utils/uuid';
import { logger } from '../utils/logger';

const log = logger('SVC:SEASONING');

function sortByCreatedAt(items: Seasoning[]): Seasoning[] {
  return [...items].sort((a, b) => new Date(a.createDate).getTime() - new Date(b.createDate).getTime());
}

export const seasoningService = {
  async getAll(): Promise<Seasoning[]> {
    const result = await storageService.get<Seasoning[]>(STORAGE_KEYS.INVENTORY_SEASONINGS);
    if (result.success && result.data) {
      const sorted = sortByCreatedAt(result.data);
      log.debug('getAll seasonings', { count: sorted.length });
      return sorted;
    }
    return [];
  },

  async add(input: SeasoningCreateInput): Promise<Seasoning> {
    const now = new Date().toISOString();
    const seasoning: Seasoning = {
      id: generateId(),
      name: input.name.trim(),
      status: input.status,
      createDate: now,
      updateDate: now,
    };
    const all = await this.getAll();
    all.push(seasoning);
    await storageService.set(STORAGE_KEYS.INVENTORY_SEASONINGS, sortByCreatedAt(all));
    log.info('Added seasoning', { name: seasoning.name, id: seasoning.id });
    return seasoning;
  },

  async update(id: string, input: Partial<SeasoningCreateInput>): Promise<Seasoning | null> {
    const all = await this.getAll();
    const index = all.findIndex((s) => s.id === id);
    if (index === -1) return null;
    all[index] = {
      ...all[index],
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updateDate: new Date().toISOString(),
    };
    await storageService.set(STORAGE_KEYS.INVENTORY_SEASONINGS, sortByCreatedAt(all));
    log.info('Updated seasoning', { name: all[index].name, id });
    return all[index];
  },

  async remove(id: string): Promise<boolean> {
    const all = await this.getAll();
    const filtered = all.filter((s) => s.id !== id);
    if (filtered.length === all.length) return false;
    await storageService.set(STORAGE_KEYS.INVENTORY_SEASONINGS, sortByCreatedAt(filtered));
    log.info('Removed seasoning', { id });
    return true;
  },

  async count(): Promise<number> {
    const all = await this.getAll();
    return all.length;
  },

  async batchSet(items: Seasoning[]): Promise<void> {
    await storageService.set(STORAGE_KEYS.INVENTORY_SEASONINGS, sortByCreatedAt(items));
  },
};
