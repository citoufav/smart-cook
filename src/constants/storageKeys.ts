export const STORAGE_KEYS = {
  INVENTORY_INGREDIENTS: '@v1:inventory:ingredients',
  INVENTORY_SEASONINGS: '@v1:inventory:seasonings',
  SETTINGS_PREFERENCES: '@v1:settings:preferences',
  SETTINGS_DRAWER_SECTIONS: '@v1:settings:drawer_sections',
  SETTINGS_API_KEY_FALLBACK: '@settings/api_key_fallback',
  COOKING_INPUT_DEFAULTS: '@v1:cooking:input_defaults',
  STORAGE_VERSION: '@v1:system:storageVersion',
  DIET_MEMORY: '@v1:diet:memory',
  DISH_LIBRARY: '@v1:dishes:library',
  CHAT_HISTORY: '@v1:chat:history',
} as const;

export const SECURE_STORE_KEY = 'secure_api_key';
