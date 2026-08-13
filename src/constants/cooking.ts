// 做菜阶段合法转换（3阶段模型：menu → prep → cooking）
export const VALID_TRANSITIONS: Record<string, string[]> = {
  requirement: ['menu', 'cancelled'],
  menu: ['prep', 'requirement', 'cancelled'],
  prep: ['cooking', 'menu', 'cancelled'],
  cooking: ['inventoryUpdate', 'prep', 'cancelled'],
  inventoryUpdate: ['completed', 'cooking', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const MAX_RETRY_COUNT = 3;

export const PEOPLE_OPTIONS = [
  { label: '1人', value: 1 },
  { label: '2人', value: 2 },
  { label: '3人', value: 3 },
  { label: '4人', value: 4 },
  { label: '自定义', value: -1 },
];

export const MEAL_TYPE_OPTIONS = [
  { label: '不限', value: 'any' },
  { label: '早餐', value: 'breakfast' },
  { label: '午餐', value: 'lunch' },
  { label: '晚餐', value: 'dinner' },
  { label: '自定义', value: 'custom' },
];

export const CALORIE_OPTIONS = [
  { label: '不限制', value: undefined },
  { label: '300卡', value: 300 },
  { label: '500卡', value: 500 },
  { label: '700卡', value: 700 },
  { label: '1000卡', value: 1000 },
  { label: '自定义', value: -1 },
];

export const CIRCLE_NUMBER_MAP: Record<string, number> = {
  '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5,
  '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
};

export const CHINESE_NUMBER_MAP: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_RETRIES = 3;
export const BASE_RETRY_DELAY_MS = 1000;
export const MAX_PATCH_ATTEMPTS = 3;

export const STEP_WIDTH = 62;

export const DAILY_RECOMMENDED = {
  /** 中国居民膳食指南：成年男性2250/女性1800，取均值 */
  calories: 2000,
  /** 蛋白质RNI：男性65g/女性55g，取均值 */
  protein: 60,
  /** 脂肪AMDR 20-30%E */
  fat: 60,
  /** 碳水AMDR 50-65%E */
  carbs: 300,
} as const;
