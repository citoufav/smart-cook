export const STORAGE_KEYS = {
  SETTINGS_PREFERENCES: '@v1:settings:preferences',
  SETTINGS_DRAWER_SECTIONS: '@v1:settings:drawer_sections',
  SETTINGS_API_KEY_FALLBACK: '@settings/api_key_fallback',
  COOKING_INPUT_DEFAULTS: '@v1:cooking:input_defaults',
  STORAGE_VERSION: '@v1:system:storageVersion',
  DIET_MEMORY: '@v1:diet:memory',
  DISH_LIBRARY: '@v1:dishes:library',
  CHAT_HISTORY: '@v1:chat:history',

  /** 库存档案清单（家里/单位…）+ 当前档案 id，一个 key 装一起保证原子 */
  INVENTORY_PROFILES: '@v1:inventory:profiles',
} as const;

/**
 * 分档案的库存 key。
 *
 * 以前是全应用一套（`@v1:inventory:ingredients`）。改成按档案存之后，
 * 老 key 只在迁移时被读一次，之后不再写 —— 但**永不删除**：
 * 万一迁移逻辑哪天出问题，用户的数据还在那儿。
 */
export function inventoryIngredientsKey(profileId: string): string {
  return `@v1:inventory:${profileId}:ingredients`;
}

export function inventorySeasoningsKey(profileId: string): string {
  return `@v1:inventory:${profileId}:seasonings`;
}

/** 只读：迁移时读老数据用，别写 */
export const LEGACY_INVENTORY_INGREDIENTS = '@v1:inventory:ingredients';
export const LEGACY_INVENTORY_SEASONINGS = '@v1:inventory:seasonings';

export const SECURE_STORE_KEY = 'secure_api_key';
