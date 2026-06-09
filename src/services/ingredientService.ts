import { storageService } from './storageService';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { Ingredient, IngredientCreateInput } from '../types';
import { generateId } from '../utils/uuid';

function sortByCreatedAt(items: Ingredient[]): Ingredient[] {
  return [...items].sort((a, b) => new Date(a.createDate).getTime() - new Date(b.createDate).getTime());
}

export const ingredientService = {
  async getAll(): Promise<Ingredient[]> {
    const result = await storageService.get<Ingredient[]>(STORAGE_KEYS.INVENTORY_INGREDIENTS);
    if (result.success && result.data) return sortByCreatedAt(result.data);
    return [];
  },

  async add(input: IngredientCreateInput): Promise<Ingredient> {
    const now = new Date().toISOString();
    const ingredient: Ingredient = {
      id: generateId(),
      name: input.name.trim(),
      weight: input.weight,
      createDate: now,
      updateDate: now,
    };
    const all = await this.getAll();
    all.push(ingredient);
    await storageService.set(STORAGE_KEYS.INVENTORY_INGREDIENTS, sortByCreatedAt(all));
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
      updateDate: new Date().toISOString(),
    };
    await storageService.set(STORAGE_KEYS.INVENTORY_INGREDIENTS, sortByCreatedAt(all));
    return all[index];
  },

  async remove(id: string): Promise<boolean> {
    const all = await this.getAll();
    const filtered = all.filter((i) => i.id !== id);
    if (filtered.length === all.length) return false;
    await storageService.set(STORAGE_KEYS.INVENTORY_INGREDIENTS, sortByCreatedAt(filtered));
    return true;
  },

  async count(): Promise<number> {
    const all = await this.getAll();
    return all.length;
  },

  async batchSet(items: Ingredient[]): Promise<void> {
    await storageService.set(STORAGE_KEYS.INVENTORY_INGREDIENTS, sortByCreatedAt(items));
  },
};
