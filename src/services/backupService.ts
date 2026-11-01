import { storageService } from './storageService';
import { inventoryProfileService } from './inventoryProfileService';
import { dishLibraryService } from './dishLibraryService';
import { cookingProgressService } from './cookingProgressService';
import { exportDietMemory, replaceDietMemory, DIET_MEMORY_LIMIT, type DietEntry } from './dietMemoryService';
import { DISH_LIBRARY_LIMIT } from '../utils/dishLibrary';
import { generateId } from '../utils/uuid';
import { logger } from '../utils/logger';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  parseBackupJson,
  mergeInventory,
  mergeRecords,
  mergeDietMemory,
  type BackupPayload,
  type BackupProfileInventory,
} from '../utils/backupFormat';
import {
  inventoryIngredientsKey,
  inventorySeasoningsKey,
} from '../constants/storageKeys';
import type { Ingredient, Seasoning, SavedDish } from '../types';

const log = logger('SVC:BACKUP');

export interface ImportSummary {
  kind: 'full' | 'legacyInventory';
  profilesCreated: number;
  ingredientsAdded: number;
  seasoningsAdded: number;
  dishesAdded: number;
  recordsAdded: number;
}

async function readProfileInventory(profileId: string): Promise<{ ingredients: Ingredient[]; seasonings: Seasoning[] }> {
  const [ing, sea] = await Promise.all([
    storageService.get<Ingredient[]>(inventoryIngredientsKey(profileId)),
    storageService.get<Seasoning[]>(inventorySeasoningsKey(profileId)),
  ]);
  return {
    ingredients: Array.isArray(ing.data) ? ing.data : [],
    seasonings: Array.isArray(sea.data) ? sea.data : [],
  };
}

async function writeProfileInventory(
  profileId: string,
  ingredients: Ingredient[],
  seasonings: Seasoning[],
): Promise<boolean> {
  const [a, b] = await Promise.all([
    storageService.set(inventoryIngredientsKey(profileId), ingredients),
    storageService.set(inventorySeasoningsKey(profileId), seasonings),
  ]);
  return a.success && b.success;
}

/**
 * 备份导出/导入。
 *
 * 导出**直接读存储**，不读 React state —— 那才是"真正存下来的东西"，
 * 而且不用关心这会儿哪个页面开着。
 *
 * 导入**只增不改**：同名库存跳过、同 id 菜品跳过、同 id 记录跳过。
 * 误选一个旧文件最坏结果是多几条数据，不会冲掉你现在的配方。
 * 详见 utils/backupFormat.ts。
 */
class BackupService {
  async exportAll(): Promise<string> {
    const profiles = await inventoryProfileService.list();
    const currentId = await inventoryProfileService.getCurrentId();

    const inventories: BackupProfileInventory[] = [];
    for (const p of profiles) {
      const data = await readProfileInventory(p.id);
      inventories.push({ id: p.id, name: p.name, ...data });
    }

    const [dishes, records, dietMemory] = await Promise.all([
      dishLibraryService.exportDishes(),
      cookingProgressService.exportRecords(),
      exportDietMemory(),
    ]);

    const payload: BackupPayload = {
      exportedAt: new Date().toISOString(),
      currentProfileId: currentId,
      profiles: inventories,
      dishes,
      records,
      dietMemory,
    };

    // 档案放在 inventory 下面（和 format 文档一致），其余平铺；
    // 不重复写两份 —— 文件里同一个东西出现两次，读的人迟早会挑错那份
    const json = JSON.stringify(
      {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: payload.exportedAt,
        inventory: { currentProfileId: currentId, profiles: inventories },
        dishes: payload.dishes,
        records: payload.records,
        dietMemory: payload.dietMemory,
      },
      null,
      2,
    );
    log.info('备份已生成', {
      profiles: inventories.length,
      dishes: dishes.length,
      records: records.length,
      chars: json.length,
    });
    return json;
  }

  async importAll(json: string): Promise<ImportSummary> {
    const parsed = parseBackupJson(json);

    if (parsed.kind === 'legacyInventory') {
      // 老格式：只有一套库存，并进当前档案
      const currentId = await inventoryProfileService.getCurrentId();
      const existing = await readProfileInventory(currentId);
      const newIngredients = mergeInventory(existing.ingredients, parsed.ingredients, generateId);
      const newSeasonings = mergeInventory(existing.seasonings, parsed.seasonings, generateId);
      const ok = await writeProfileInventory(
        currentId,
        [...existing.ingredients, ...newIngredients],
        [...existing.seasonings, ...newSeasonings],
      );
      if (!ok) throw new Error('写入库存失败（可能是空间不足）');
      log.info('老格式备份已导入当前档案', {
        ingredients: newIngredients.length,
        seasonings: newSeasonings.length,
      });
      return {
        kind: 'legacyInventory',
        profilesCreated: 0,
        ingredientsAdded: newIngredients.length,
        seasoningsAdded: newSeasonings.length,
        dishesAdded: 0,
        recordsAdded: 0,
      };
    }

    const payload = parsed.payload;
    const existingProfiles = await inventoryProfileService.list();
    let profilesCreated = 0;
    let ingredientsAdded = 0;
    let seasoningsAdded = 0;

    for (const incoming of payload.profiles) {
      // 按名字认档案：id 是本机随机生成的，跨设备没意义
      const match = existingProfiles.find((p) => p.name === incoming.name);
      const targetId = match?.id ?? (await inventoryProfileService.create(incoming.name))?.id;
      if (!targetId) {
        log.warn('备份里的档案没能建出来（重名或超量），已跳过', { name: incoming.name });
        continue;
      }
      if (!match) profilesCreated++;

      const existing = await readProfileInventory(targetId);
      const newIngredients = mergeInventory(existing.ingredients, incoming.ingredients, generateId);
      const newSeasonings = mergeInventory(existing.seasonings, incoming.seasonings, generateId);
      if (newIngredients.length === 0 && newSeasonings.length === 0) continue;

      const ok = await writeProfileInventory(
        targetId,
        [...existing.ingredients, ...newIngredients],
        [...existing.seasonings, ...newSeasonings],
      );
      if (ok) {
        ingredientsAdded += newIngredients.length;
        seasoningsAdded += newSeasonings.length;
      } else {
        log.error('库存写入失败', { profile: incoming.name });
      }
    }

    const dishesAdded = await dishLibraryService.importDishes(
      payload.dishes as SavedDish[],
      DISH_LIBRARY_LIMIT,
    );

    let recordsAdded = 0;
    if (payload.records.length > 0) {
      const existing = await cookingProgressService.exportRecords();
      const merged = mergeRecords(existing, payload.records);
      recordsAdded = merged.length - existing.length;
      if (recordsAdded > 0) await cookingProgressService.replaceRecords(merged);
    }

    if (payload.dietMemory.length > 0) {
      const existing = await exportDietMemory();
      const merged: DietEntry[] = mergeDietMemory(existing, payload.dietMemory, DIET_MEMORY_LIMIT);
      if (merged.length !== existing.length) await replaceDietMemory(merged);
    }

    log.info('备份导入完成', {
      profilesCreated, ingredientsAdded, seasoningsAdded, dishesAdded, recordsAdded,
    });
    return {
      kind: 'full',
      profilesCreated,
      ingredientsAdded,
      seasoningsAdded,
      dishesAdded,
      recordsAdded,
    };
  }
}

export const backupService = new BackupService();

/** 方便拼一句人话给用户看 */
export function describeImport(s: ImportSummary): string {
  const parts: string[] = [];
  if (s.profilesCreated > 0) parts.push(`新档案 ${s.profilesCreated} 个`);
  if (s.ingredientsAdded > 0) parts.push(`食材 ${s.ingredientsAdded} 种`);
  if (s.seasoningsAdded > 0) parts.push(`调料 ${s.seasoningsAdded} 种`);
  if (s.dishesAdded > 0) parts.push(`菜品 ${s.dishesAdded} 道`);
  if (s.recordsAdded > 0) parts.push(`菜单记录 ${s.recordsAdded} 条`);
  if (parts.length === 0) return '没有需要新增的内容，你现在的数据已经是全的了';
  return `新增了${parts.join('、')}。已有的数据一条没动。`;
}
