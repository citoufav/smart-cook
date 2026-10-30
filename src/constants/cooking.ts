// Valid cooking stage transitions (3-stage model: menu → prep → cooking)
export const VALID_TRANSITIONS: Record<string, string[]> = {
  requirement: ['menu', 'cancelled'],
  menu: ['prep', 'requirement', 'cancelled'],
  prep: ['cooking', 'menu', 'cancelled'],
  cooking: ['inventoryUpdate', 'prep', 'cancelled'],
  inventoryUpdate: ['completed', 'cooking', 'cancelled'],
  completed: [],
  cancelled: [],
};

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

export const DAILY_RECOMMENDED = {
  /** Chinese Dietary Guidelines: 2250 kcal for adult males / 1800 for females; use the average */
  calories: 2000,
  /** Protein RNI: 65g for males / 55g for females; use the average */
  protein: 60,
  /** Fat AMDR 20-30%E */
  fat: 60,
  /** Carbs AMDR 50-65%E */
  carbs: 300,
} as const;
