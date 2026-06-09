export const STORAGE_KEYS = {
  INVENTORY_INGREDIENTS: '@v1:inventory:ingredients',
  INVENTORY_SEASONINGS: '@v1:inventory:seasonings',
  SETTINGS_PREFERENCES: '@v1:settings:preferences',
  SETTINGS_API_KEY_FALLBACK: '@settings/api_key_fallback',
  COOKING_INPUT_DEFAULTS: '@v1:cooking:input_defaults',
  COOKING_SESSION_ACTIVE: '@v1:cooking:session:active',
  COOKING_SESSION_HISTORY: '@v1:cooking:session:history',
  STAGE2_PROGRESS: '@v1:cooking:stage2_progress',
  EXECUTION_PROGRESS: '@v1:cooking:execution_progress',
  SHOPPING_LIST_ACTIVE: '@v1:shopping:list:active',
  UNDO_SNAPSHOT: '@v1:system:undo_snapshot',
  STORAGE_VERSION: '@v1:system:storageVersion',
} as const;

export const SECURE_STORE_KEY = 'secure_api_key';
