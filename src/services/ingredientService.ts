import { storageService } from './storageService';
import { inventoryIngredientsKey } from '../constants/storageKeys';
import { inventoryProfileService } from './inventoryProfileService';
import { Ingredient, IngredientCreateInput } from '../types';
import { generateId } from '../utils/uuid';
import { logger } from '../utils/logger';

const log = logger('SVC:INGREDIENT');

/** 库存跟着档案走：家里和单位各一套。每次操作现问当前档案是谁 */
async function currentKey(): Promise<string> {
  return inventoryIngredientsKey(await inventoryProfileService.getCurrentId());
}

function sortByCreatedAt(items: Ingredient[]): Ingredient[] {
  return [...items].sort((a, b) => new Date(a.createDate).getTime() - new Date(b.createDate).getTime());
}

export const ingredientService = {
  async getAll(): Promise<Ingredient[]> {
    const result = await storageService.get<Ingredient[]>(await currentKey());
    if (result.success && result.data) {
      const sorted = sortByCreatedAt(result.data);
      log.debug('getAll ingredients', { count: sorted.length });
      return sorted;
    }
    return [];
  },

  async add(input: IngredientCreateInput): Promise<Ingredient> {
    const now = new Date().toISOString();
    const createDateVal = input.createDate || now;
    const ingredient: Ingredient = {
      id: generateId(),
      name: input.name.trim(),
      weight: input.weight,
      createDate: createDateVal,
      updateDate: now,
      ...(input.expireDate !== undefined ? { expireDate: input.expireDate } : {}),
    };
    const all = await this.getAll();
    all.push(ingredient);
    await storageService.set(await currentKey(), sortByCreatedAt(all));
    log.info('Added ingredient', { name: ingredient.name, id: ingredient.id });
    return ingredient;
  },

  async update(id: string, input: Partial<IngredientCreateInput>): Promise<Ingredient | null> {
    const all = await this.getAll();
    const index = all.findIndex((i) => i.id === id);
    if (index === -1) return null;
    all[index] = {
      ...all[index],
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
      ...(input.createDate !== undefined ? { createDate: input.createDate } : {}),
      ...(input.expireDate !== undefined ? { expireDate: input.expireDate } : {}),
      updateDate: new Date().toISOString(),
    };
    await storageService.set(await currentKey(), sortByCreatedAt(all));
    log.info('Updated ingredient', { name: all[index].name, id });
    return all[index];
  },

  async remove(id: string): Promise<boolean> {
    const all = await this.getAll();
    const filtered = all.filter((i) => i.id !== id);
    if (filtered.length === all.length) return false;
    await storageService.set(await currentKey(), sortByCreatedAt(filtered));
    log.info('Removed ingredient', { id });
    return true;
  },

  async count(): Promise<number> {
    const all = await this.getAll();
    return all.length;
  },

  async batchSet(items: Ingredient[]): Promise<void> {
    await storageService.set(await currentKey(), sortByCreatedAt(items));
  },
};
