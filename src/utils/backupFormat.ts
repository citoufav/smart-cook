import type { Ingredient, Seasoning, SavedDish, SeasoningStatus, DishPlan } from '../types';
import type { CookingProgressRecord } from '../services/cookingProgressService';
import type { DietEntry } from '../services/dietMemoryService';

/**
 * 备份文件的格式与合并规则。纯函数，不碰存储，所以能用 node 直接跑（npm run check:backup）。
 *
 * 两条原则贯穿全文件：
 *
 * 1. **导入只增不改**。已有的东西一条都不动，导入最多让它变多。
 *    误选一个旧文件、或者别人发来一个乱七八糟的包，最坏结果是多几条没用的数据，
 *    而不是把你现在的配方冲掉。
 *
 * 2. **从文件里来的对象一律白名单重建**，绝不 `{...untrusted}` 展开进 state。
 *    这是防原型污染的唯一实质防线（`JSON.parse('{"__proto__":…}')` 展开是安全的，
 *    但一旦有深度 merge 就不好说了）。
 */

export const BACKUP_FORMAT = 'suizhu-backup';
export const BACKUP_VERSION = 2;
/** 文件字符数上限（≈ 20MB）。再大就不是备份文件了，是炸弹 */
export const MAX_BACKUP_CHARS = 20 * 1024 * 1024;
/** 单个数组的上限，防止 500 万条把内存撑爆 */
const MAX_ITEMS = 5000;

export interface BackupProfileInventory {
  id: string;
  name: string;
  ingredients: Ingredient[];
  seasonings: Seasoning[];
}

export interface BackupPayload {
  exportedAt: string;
  currentProfileId: string;
  profiles: BackupProfileInventory[];
  dishes: SavedDish[];
  records: CookingProgressRecord[];
  dietMemory: DietEntry[];
}

/** 老格式（v1，顶层直接是 ingredients/seasonings）没有档案概念，只能并进当前档案 */
export type ParsedBackup =
  | { kind: 'full'; payload: BackupPayload }
  | { kind: 'legacyInventory'; ingredients: Ingredient[]; seasonings: Seasoning[] };

// ---------------------------------------------------------------------------
// 读取与校验
// ---------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const optNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean => v === true;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []);
const obj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const SEASONING_STATUSES: SeasoningStatus[] = ['sufficient', 'low', 'out'];

function readIngredient(raw: unknown, now: string): Ingredient | null {
  const o = obj(raw);
  const name = str(o.name).trim();
  if (!name) return null;
  const expireDate = str(o.expireDate);
  return {
    id: str(o.id) || `imp-${name}`,
    name,
    weight: optNum(o.weight),
    createDate: str(o.createDate) || now,
    updateDate: str(o.updateDate) || now,
    ...(expireDate ? { expireDate } : {}),
  };
}

function readSeasoning(raw: unknown, now: string): Seasoning | null {
  const o = obj(raw);
  const name = str(o.name).trim();
  if (!name) return null;
  const status = SEASONING_STATUSES.includes(o.status as SeasoningStatus)
    ? (o.status as SeasoningStatus)
    : 'sufficient';
  return {
    id: str(o.id) || `imp-${name}`,
    name,
    status,
    createDate: str(o.createDate) || now,
    updateDate: str(o.updateDate) || now,
  };
}

/** 一道菜里跟热量、采购有关的部分才重建；步骤只保留能被渲染的文字 */
function readDish(raw: unknown): SavedDish | null {
  const o = obj(raw);
  const name = str(o.name).trim();
  if (!name) return null;

  const ingredients = arr(o.ingredients)
    .map((x) => {
      const i = obj(x);
      const n = str(i.name).trim();
      if (!n) return null;
      const kcal = optNum(i.kcalPer100g);
      return {
        name: n,
        estimatedWeight: num(i.estimatedWeight),
        isInInventory: bool(i.isInInventory),
        ...(kcal !== null ? { kcalPer100g: kcal } : {}),
      };
    })
    .filter((x): x is DishPlan['ingredients'][number] => x !== null);

  const seasonings = arr(o.seasonings)
    .map((x) => {
      const s = obj(x);
      const n = str(s.name).trim();
      if (!n) return null;
      const kcal = optNum(s.kcalPer100g);
      return {
        name: n,
        amount: str(s.amount),
        isInInventory: bool(s.isInInventory),
        ...(kcal !== null ? { kcalPer100g: kcal } : {}),
      };
    })
    .filter((x): x is DishPlan['seasonings'][number] => x !== null);

  const prepSteps = arr(o.prepSteps).map((x, idx) => {
    const s = obj(x);
    return {
      id: str(s.id) || `p-${idx}`,
      ingredientName: str(s.ingredientName),
      quantity: str(s.quantity),
      description: str(s.description),
      isCompleted: false,
      order: idx + 1,
    };
  });

  const cookingSteps = arr(o.cookingSteps).map((x, idx) => {
    const s = obj(x);
    return {
      stepNumber: idx + 1,
      instruction: str(s.instruction),
      isCompleted: false,
    };
  });

  const n = obj(o.estimatedNutrition);
  return {
    id: str(o.id).trim() || name,
    name,
    ingredients,
    seasonings,
    estimatedNutrition: {
      calories: num(n.calories),
      protein: num(n.protein),
      fat: num(n.fat),
      carbs: num(n.carbs),
    },
    prepSteps,
    cookingSteps,
    basePersonCount: Math.max(1, Math.round(num(o.basePersonCount) || 1)),
    timesCooked: Math.max(0, Math.round(num(o.timesCooked))),
    lastCookedAt: str(o.lastCookedAt) || new Date().toISOString(),
    createdAt: str(o.createdAt) || str(o.lastCookedAt) || new Date().toISOString(),
  };
}

/**
 * 菜单记录只做浅校验。
 *
 * ponytail: 它的内容（session.stages.menu.menuProposal.dishes…）有五六层，
 * 逐字段重建要一百多行，而这些记录**只用来显示历史**，不参与热量计算、
 * 不喂给 AI；渲染层本来就有空值容错。真要更严就给它上 zod schema。
 */
function readRecord(raw: unknown): CookingProgressRecord | null {
  const o = obj(raw);
  const id = str(o.id).trim();
  const session = obj(o.session);
  if (!id || Object.keys(session).length === 0) return null;
  return {
    id,
    name: str(o.name) || '未命名菜单',
    createdAt: str(o.createdAt) || new Date().toISOString(),
    updatedAt: str(o.updatedAt) || str(o.createdAt) || new Date().toISOString(),
    currentStage: (str(o.currentStage) || 'menu') as CookingProgressRecord['currentStage'],
    session: session as unknown as CookingProgressRecord['session'],
    ...(o.isCompleted === true ? { isCompleted: true } : {}),
  };
}

function readDietEntry(raw: unknown): DietEntry | null {
  const o = obj(raw);
  const name = str(o.name).trim();
  if (!name) return null;
  return { name, timestamp: str(o.timestamp) || new Date().toISOString() };
}

export function parseBackupJson(json: string, now = new Date().toISOString()): ParsedBackup {
  if (typeof json !== 'string' || json.trim().length === 0) {
    throw new Error('文件是空的');
  }
  if (json.length > MAX_BACKUP_CHARS) {
    throw new Error(`文件太大了（超过 ${Math.round(MAX_BACKUP_CHARS / 1024 / 1024)}MB），不像备份文件`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }
  const o = obj(raw);

  // 老格式：顶层直接是 ingredients/seasonings，没有 format 字段
  if (str(o.format) !== BACKUP_FORMAT) {
    if (Array.isArray(o.ingredients) && Array.isArray(o.seasonings)) {
      return {
        kind: 'legacyInventory',
        ingredients: arr(o.ingredients).map((x) => readIngredient(x, now)).filter((x): x is Ingredient => x !== null),
        seasonings: arr(o.seasonings).map((x) => readSeasoning(x, now)).filter((x): x is Seasoning => x !== null),
      };
    }
    throw new Error('这不是随煮的备份文件');
  }

  const version = num(o.version);
  if (version > BACKUP_VERSION) {
    throw new Error('这个备份来自更新版本的随煮，请先升级应用');
  }

  const inv = obj(o.inventory);
  const profiles = arr(inv.profiles).map((p): BackupProfileInventory => {
    const po = obj(p);
    return {
      id: str(po.id).trim() || 'imported',
      name: str(po.name).trim() || '导入的库存',
      ingredients: arr(po.ingredients).map((x) => readIngredient(x, now)).filter((x): x is Ingredient => x !== null),
      seasonings: arr(po.seasonings).map((x) => readSeasoning(x, now)).filter((x): x is Seasoning => x !== null),
    };
  });

  return {
    kind: 'full',
    payload: {
      exportedAt: str(o.exportedAt) || now,
      currentProfileId: str(inv.currentProfileId),
      profiles,
      dishes: arr(o.dishes).map(readDish).filter((x): x is SavedDish => x !== null),
      records: arr(o.records).map(readRecord).filter((x): x is CookingProgressRecord => x !== null),
      dietMemory: arr(o.dietMemory).map(readDietEntry).filter((x): x is DietEntry => x !== null),
    },
  };
}

// ---------------------------------------------------------------------------
// 合并：只增不改
// ---------------------------------------------------------------------------

/**
 * 库存合并：同名跳过，其余追加。
 *
 * 传进来的 `incoming` 必须是 readIngredient/readSeasoning **重建过**的对象
 * （白名单字段），不要直接把 JSON.parse 的结果丢进来。
 *
 * @returns 需要新增的条目（已重新分配 id，避免和本地撞号）
 */
export function mergeInventory<T extends { id: string; name: string }>(
  existing: { name: string }[],
  incoming: T[],
  nextId: () => string,
): T[] {
  const seen = new Set(existing.map((i) => i.name.trim()));
  const added: T[] = [];
  for (const item of incoming) {
    const name = (item.name ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    added.push({ ...item, name, id: nextId() });
  }
  return added;
}

/** 菜品合并：id（归一化菜名）已存在就整条跳过，绝不覆盖你现有的配方 */
export function mergeDishes(existing: SavedDish[], incoming: SavedDish[], limit: number): SavedDish[] {
  const seen = new Set(existing.map((d) => d.id.trim()));
  const added: SavedDish[] = [];
  for (const d of incoming) {
    const id = d.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    added.push(d);
  }
  return [...existing, ...added]
    .sort((a, b) => (a.lastCookedAt < b.lastCookedAt ? 1 : a.lastCookedAt > b.lastCookedAt ? -1 : 0))
    .slice(0, limit);
}

/** 菜单记录：按 id 去重，新的在前 */
export function mergeRecords(
  existing: CookingProgressRecord[],
  incoming: CookingProgressRecord[],
): CookingProgressRecord[] {
  const seen = new Set(existing.map((r) => r.id));
  const added = incoming.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  return [...existing, ...added].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** 饮食记忆：按「菜名+时间」去重，保留最近的 limit 条 */
export function mergeDietMemory(existing: DietEntry[], incoming: DietEntry[], limit: number): DietEntry[] {
  const seen = new Set(existing.map((e) => `${e.name}|${e.timestamp}`));
  const added = incoming.filter((e) => {
    const key = `${e.name}|${e.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...existing, ...added]
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, limit);
}
