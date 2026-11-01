// ============ Ingredients & Seasonings ============
export interface Ingredient {
  id: string;
  name: string;
  weight: number | null;
  createDate: string;
  updateDate: string;
  /** 过期日（ISO 字符串）。undefined = 未设置，库存页不提醒。R-5 过期提醒用 */
  expireDate?: string;
}

export interface IngredientCreateInput {
  name: string;
  weight: number | null;
  createDate?: string;
  expireDate?: string;
}

export interface Seasoning {
  id: string;
  name: string;
  status: SeasoningStatus;
  createDate: string;
  updateDate: string;
}

export type SeasoningStatus = 'sufficient' | 'low' | 'out';

export interface SeasoningCreateInput {
  name: string;
  status: SeasoningStatus;
}

// ============ Inventory State ============
export interface InventoryState {
  ingredients: Ingredient[];
  seasonings: Seasoning[];
  ingredientsLoading: boolean;
  seasoningsLoading: boolean;
  ingredientsError: string | null;
  seasoningsError: string | null;
}

// ============ User Settings ============
export type ApiType = 'deepseek' | 'openai';

/** DeepSeek 思考模式的档位。`low` 是 2026 版模型新增的，老版本只有 high/max */
export type ReasoningEffort = 'low' | 'high' | 'max';

/**
 * 烹饪熟练度，决定步骤描述写到多细。
 * 只影响火候/时长/判断标准这类说明，**不影响用量克重**——库存扣减依赖 dishes 里的精确克数。
 */
export type CookingSkill = 'beginner' | 'intermediate' | 'experienced';

export interface UserPreferences {
  apiType: ApiType;
  apiKey: string;
  apiUrl: string;
  modelName: string;
  dietaryRestrictions: string[];
  /** Preferred cuisines / flavours chosen during onboarding (e.g. 川菜, 清淡) */
  tastePreferences: string[];
  /** True once the first-launch onboarding has been completed or skipped */
  onboardingDone: boolean;
  /** UI 与 AI 输出语言（BCP-47，如 'zh-CN'）。目前只有中文，R-1 i18n 用 */
  locale: string;
  /** 菜系 id 列表。目前恒为空，R-2 多菜系用；tastePreferences 仍是自由文本 */
  cuisineIds: string[];
  lastPersonCount?: number;
  lastMealType?: string;
  lastCaloriePreference?: number;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  /** 烹饪熟练度，喂给 AI 决定步骤描述的详细程度 */
  cookingSkill: CookingSkill;
}

// ============ Cooking Requirement ============
export interface RequirementInput {
  personCount: number;
  mealType: MealType;
  caloriePreference: number | undefined;
  customRequirement: string;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'any';

// ============ Menu Proposal ============
export interface DishIngredient {
  name: string;
  estimatedWeight: number;
  isInInventory: boolean;
}

export interface DishSeasoning {
  name: string;
  amount: string;
  isInInventory: boolean;
}

export interface DishNutrition {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

/**
 * 一道菜 = 一个自包含的模块。
 *
 * 菜名、食材、调料、热量、备菜步骤、炒制步骤全部挂在这里，不再有菜单级的
 * prepSteps / cookingSteps / preciseNutrition 平行数组。带 id 是为了让菜品
 * 可以脱离这份菜单单独存在（菜品库、历史菜单选菜都靠它）。
 */
export interface DishPlan {
  id: string;
  name: string;
  ingredients: DishIngredient[];
  seasonings: DishSeasoning[];
  estimatedNutrition: DishNutrition;
  /**
   * AI 按最终克重重算的一份营养估算（同一份响应里给的 preciseNutrition）。
   * 有值时营养面板按"精确"显示，没有就退回 estimatedNutrition。
   */
  preciseNutrition?: DishNutrition;
  prepSteps: PrepStep[];
  cookingSteps: CookingStep[];
}

export interface MenuSummary {
  description: string;
  cookingOrder: string;
  flavorNotes: string;
}

export interface ShoppingItem {
  id: string;
  type: 'ingredient' | 'seasoning';
  name: string;
  suggestedAmount: string;
  forDish: string;
  isPurchased: boolean;
}

export interface MenuProposal {
  dishes: DishPlan[];
  estimatedNutrition: NutritionInfo;
  missingItems: ShoppingItem[];
  cookingOrderDescription: string;
  flavorDescription: string;
  summary: MenuSummary;
}

// ============ AI-Generated Plan ============

/** 备菜步骤。归属由所在的 DishPlan 决定，不再用 dishName 挂靠 */
export interface PrepStep {
  id: string;
  ingredientName: string;
  quantity: string;
  description: string;
  isCompleted: boolean;
  /** 在这道菜内的序号，从 1 开始 */
  order: number;
}

/** 炒制步骤。归属由所在的 DishPlan 决定 */
export interface CookingStep {
  /** 在这道菜内的序号，从 1 开始 */
  stepNumber: number;
  instruction: string;
  isCompleted: boolean;
}

// ============ Nutrition Info ============
export interface NutritionInfo {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface NutritionalData {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  source: 'estimated' | 'precise';
}

// ============ Inventory Update ============
export interface IngredientSuggestion {
  ingredientId: string;
  ingredientName: string;
  usedGrams: number;
  currentStock: number | null;
  suggestedRemaining: number | null;
  isSufficient: boolean;
  dishes: string[];
}

export interface SeasoningSuggestion {
  seasoningId: string;
  seasoningName: string;
  currentStatus: SeasoningStatus;
  suggestedStatus: SeasoningStatus | null;
  wasUsed: boolean;
}

export interface InventoryUpdateData {
  ingredientUpdates: IngredientSuggestion[];
  seasoningUpdates: SeasoningSuggestion[];
}

// ============ Cooking Session ============
export type CookingStage =
  | 'requirement'
  | 'menu'
  | 'prep'
  | 'cooking'
  | 'inventoryUpdate'
  | 'completed'
  | 'cancelled';

export interface Stage1Data {
  menuProposal: MenuProposal;
  requirementInput: RequirementInput;
  reasoningContent?: string;
}

export interface CookingSessionStages {
  requirement?: RequirementInput;
  menu?: Stage1Data;
}

export interface CookingSession {
  id: string;
  status: CookingStage;
  stages: CookingSessionStages;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CookingState {
  session: CookingSession | null;
  error: string | null;
}

// ============ Nutrition Context State ============
export interface NutritionState {
  nutritionByDish: Record<string, NutritionalData>;
  dishNames: string[];
  totalNutrition: NutritionInfo;
  personCount: number;
  accuracy: 'none' | 'estimated' | 'precise';
  isVisible: boolean;
  isDetailOpen: boolean;
  dataSource: string | null;
}

// ============ Settings Context State ============
export interface SettingsState {
  preferences: UserPreferences;
  isLoading: boolean;
  error: string | null;
}

// ============ Inventory Check ============
export interface InventoryCheckResult {
  isEmpty: boolean;
  isLowInventory: boolean;
  ingredientCount: number;
}

// ============ Stage Model ============
/** Cooking stage index (0-2), mapping recipe → prep → cooking */
export const STAGE_INDEX_MAP: Record<string, number> = {
  menu: 0,
  prep: 1,
  cooking: 2,
};

export const STAGE_KEYS: CookingStage[] = ['menu', 'prep', 'cooking'];

/** Get the 0-based index from CookingStage */
export function getStageIndex(stage: CookingStage): number {
  return STAGE_INDEX_MAP[stage] ?? -1;
}

/** Get the CookingStage from an index */
export function getStageKeyByIndex(index: number): CookingStage {
  return STAGE_KEYS[index] || 'menu';
}
