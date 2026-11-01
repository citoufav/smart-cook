import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DishPlan, SavedDish } from '../types';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { logger } from '../utils/logger';
import { mergeDishIntoLibrary, normalizeDishName } from '../utils/dishLibrary';

/**
 * 菜品库的读写层。合并规则在 utils/dishLibrary.ts（纯函数，可单测），
 * 这里只负责落盘、容错、以及"数据损坏时留一份备份"。
 */
class DishLibraryService {
  private log = logger('SVC:DISH_LIB');

  private async getAll(): Promise<SavedDish[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.DISH_LIBRARY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SavedDish[]) : [];
    } catch (e) {
      this.log.error('菜品库解析失败', e);
      // 和数据损坏时一样：先把原文备份下来，别让它在下一次写入时静默消失
      try {
        const corrupted = await AsyncStorage.getItem(STORAGE_KEYS.DISH_LIBRARY);
        if (corrupted) {
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          await AsyncStorage.setItem(`${STORAGE_KEYS.DISH_LIBRARY}_corrupted_${ts}`, corrupted);
        }
      } catch {}
      return [];
    }
  }

  private async saveAll(items: SavedDish[]): Promise<boolean> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.DISH_LIBRARY, JSON.stringify(items));
      return true;
    } catch (e) {
      this.log.error('菜品库写入失败', e);
      return false;
    }
  }

  /** 按「最近做过」排序的完整列表 */
  async list(): Promise<SavedDish[]> {
    const items = await this.getAll();
    return items.sort((a, b) => (a.lastCookedAt < b.lastCookedAt ? 1 : -1));
  }

  async get(id: string): Promise<SavedDish | undefined> {
    const items = await this.getAll();
    return items.find((d) => d.id === id);
  }

  /**
   * 做完一道菜单后把里面的菜并进库。
   * @returns 这次入库的菜品数；写盘失败返回 -1（调用方据此决定要不要提示）
   */
  async saveMenu(dishes: DishPlan[], personCount: number): Promise<number> {
    if (dishes.length === 0) return 0;
    const existing = await this.getAll();
    const merged = mergeDishIntoLibrary(existing, dishes, personCount, new Date().toISOString());
    if (!(await this.saveAll(merged))) return -1;
    const touched = dishes.filter((d) => normalizeDishName(d.name ?? '')).length;
    this.log.info('菜单已并入菜品库', { touched, total: merged.length });
    return touched;
  }

  async remove(id: string): Promise<boolean> {
    const items = await this.getAll();
    const next = items.filter((d) => d.id !== id);
    if (next.length === items.length) return false;
    const ok = await this.saveAll(next);
    if (ok) this.log.info('已从菜品库删除', { id });
    return ok;
  }
}

export const dishLibraryService = new DishLibraryService();
