import { storageService } from './storageService';
import {
  STORAGE_KEYS,
  LEGACY_INVENTORY_INGREDIENTS,
  LEGACY_INVENTORY_SEASONINGS,
  inventoryIngredientsKey,
  inventorySeasoningsKey,
} from '../constants/storageKeys';
import { logger } from '../utils/logger';

const log = logger('SVC:INV_PROFILE');

export interface InventoryProfile {
  id: string;
  name: string;
  createdAt: string;
}

export interface InventoryProfilesBlob {
  version: 1;
  currentId: string;
  items: InventoryProfile[];
}

/** 默认档案。老用户升级后所有数据都落在这一档里 */
export const DEFAULT_PROFILE_ID = 'home';
export const DEFAULT_PROFILE_NAME = '家里';
export const MAX_PROFILE_NAME = 12;
export const MAX_PROFILES = 10;

const BLOB_KEY = STORAGE_KEYS.INVENTORY_PROFILES;

/** 档案 id 会拼进 storage key，只允许安全字符，别让名字里的冒号污染 key 空间 */
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

function newProfileId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidBlob(v: unknown): v is InventoryProfilesBlob {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  if (!Array.isArray(b.items) || b.items.length === 0) return false;
  if (typeof b.currentId !== 'string') return false;
  const ok = (b.items as unknown[]).every(
    (p) => p && typeof p === 'object'
      && typeof (p as Record<string, unknown>).id === 'string'
      && SAFE_ID.test((p as Record<string, unknown>).id as string)
      && typeof (p as Record<string, unknown>).name === 'string',
  );
  if (!ok) return false;
  // currentId 必须指向真实存在的档案，否则整套库存会读不到
  return (b.items as InventoryProfile[]).some((p) => p.id === b.currentId);
}

/**
 * 库存档案（家里 / 单位 …）。
 *
 * 只有**库存**分档案：我的菜、菜单记录、设置都是跟人走的，不跟地点走。
 *
 * 老数据迁移的顺序是刻意的：先把数据写成新 key，再写档案清单（那个指针）。
 * 万一中途失败，清单还没写，下次启动会重跑迁移；老 key 一直留着自己不动。
 */
class InventoryProfileService {
  private blob: InventoryProfilesBlob | null = null;
  private loading: Promise<InventoryProfilesBlob> | null = null;

  /** 读档案清单；不存在就做一次迁移。并发调用共享同一个 promise */
  private async load(): Promise<InventoryProfilesBlob> {
    if (this.blob) return this.blob;
    if (!this.loading) {
      this.loading = this.doLoad().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  private async doLoad(): Promise<InventoryProfilesBlob> {
    // 刻意不用 safeGetJSON：它读到损坏数据时会写回默认值，
    // 而这里的默认值是"没有档案"，写回去等于把两个档案一起弄丢（数据还在 key 里，但没人指向它们）
    const res = await storageService.get<unknown>(BLOB_KEY);
    const raw = res.success ? (res.data ?? null) : null;
    if (!res.success) log.error('档案清单读取失败', { error: res.error });
    if (isValidBlob(raw)) {
      this.blob = raw;
      return raw;
    }
    if (raw !== null) log.warn('档案清单格式不对，按老数据重建');
    const migrated = await this.migrate();
    this.blob = migrated;
    return migrated;
  }

  private async migrate(): Promise<InventoryProfilesBlob> {
    const now = new Date().toISOString();
    const profile: InventoryProfile = { id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, createdAt: now };

    const [legacyIng, legacySea] = await Promise.all([
      storageService.get<unknown[]>(LEGACY_INVENTORY_INGREDIENTS),
      storageService.get<unknown[]>(LEGACY_INVENTORY_SEASONINGS),
    ]);
    const ingredients = Array.isArray(legacyIng.data) ? legacyIng.data : [];
    const seasonings = Array.isArray(legacySea.data) ? legacySea.data : [];

    // 1) 先写数据
    await storageService.set(inventoryIngredientsKey(profile.id), ingredients);
    await storageService.set(inventorySeasoningsKey(profile.id), seasonings);

    // 2) 读回来核对，对不上就不写指针（宁可下次重跑，也不要让人看到空库存）
    const [checkIng, checkSea] = await Promise.all([
      storageService.get<unknown[]>(inventoryIngredientsKey(profile.id)),
      storageService.get<unknown[]>(inventorySeasoningsKey(profile.id)),
    ]);
    const verified = Array.isArray(checkIng.data)
      && checkIng.data.length === ingredients.length
      && Array.isArray(checkSea.data)
      && checkSea.data.length === seasonings.length;

    if (!verified) {
      log.error('库存迁移校验失败，保留老数据并退回默认档案', {
        legacyIngredients: ingredients.length,
        legacySeasonings: seasonings.length,
      });
      // 指针还是得写，否则应用没法工作；但老 key 一个字都不动，数据还在
    }

    const blob: InventoryProfilesBlob = { version: 1, currentId: profile.id, items: [profile] };
    await storageService.set(BLOB_KEY, blob);
    log.info('库存档案已初始化', {
      profileId: profile.id,
      ingredients: ingredients.length,
      seasonings: seasonings.length,
      verified,
    });
    return blob;
  }

  private async persist(blob: InventoryProfilesBlob): Promise<boolean> {
    const res = await storageService.set(BLOB_KEY, blob);
    if (!res.success) {
      log.error('档案清单写入失败', res.error);
      return false;
    }
    this.blob = blob;
    return true;
  }

  /** 当前档案 id。所有库存读写都要先问它 */
  async getCurrentId(): Promise<string> {
    return (await this.load()).currentId;
  }

  async list(): Promise<InventoryProfile[]> {
    return (await this.load()).items;
  }

  async getCurrent(): Promise<InventoryProfile> {
    const blob = await this.load();
    return blob.items.find((p) => p.id === blob.currentId) ?? blob.items[0];
  }

  async switchTo(id: string): Promise<boolean> {
    const blob = await this.load();
    if (!blob.items.some((p) => p.id === id)) return false;
    if (blob.currentId === id) return true;
    return this.persist({ ...blob, currentId: id });
  }

  /**
   * 新建一个档案并切过去。
   * @returns 新档案；名字为空/重复/超量时返回 null
   */
  async create(rawName: string): Promise<InventoryProfile | null> {
    const name = (rawName ?? '').trim().slice(0, MAX_PROFILE_NAME);
    if (!name) return null;

    const blob = await this.load();
    if (blob.items.length >= MAX_PROFILES) return null;
    if (blob.items.some((p) => p.name === name)) return null;

    const profile: InventoryProfile = { id: newProfileId(), name, createdAt: new Date().toISOString() };
    // 新档案是空的，但 key 要显式写一次空数组：读取时不用区分"没写过"和"空"
    await storageService.set(inventoryIngredientsKey(profile.id), []);
    await storageService.set(inventorySeasoningsKey(profile.id), []);

    const ok = await this.persist({ ...blob, items: [...blob.items, profile], currentId: profile.id });
    if (!ok) return null;
    log.info('新建库存档案', { id: profile.id, name });
    return profile;
  }

  /**
   * 删掉一个档案，连同它那一套库存数据。
   * @returns 删完之后该用哪个档案；删失败（只剩一个 / 不存在 / 写盘失败）返回 null
   *
   * 顺序是刻意的：先改清单指针，再删数据。反过来的话万一写盘失败，
   * 清单里还挂着这个档案，但里面的库存已经是空的。
   */
  async remove(id: string): Promise<string | null> {
    const blob = await this.load();
    // 只剩一个就不给删：清单必须至少指向一个档案，否则整套库存读不出来
    if (blob.items.length <= 1) return null;
    const target = blob.items.find((p) => p.id === id);
    if (!target) return null;

    const items = blob.items.filter((p) => p.id !== id);
    // 删的正好是当前档案时，顺手切到剩下第一个，不然指针悬空
    const currentId = blob.currentId === id ? items[0].id : blob.currentId;
    if (!(await this.persist({ ...blob, items, currentId }))) return null;

    await storageService.remove(inventoryIngredientsKey(id));
    await storageService.remove(inventorySeasoningsKey(id));
    log.info('删除库存档案', { id, name: target.name, currentId });
    return currentId;
  }

  /** 供测试/调试：清掉内存缓存，下次读取重新从存储加载 */
  invalidateCache(): void {
    this.blob = null;
    this.loading = null;
  }
}

export const inventoryProfileService = new InventoryProfileService();
