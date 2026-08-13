// ============ Ingredients & Seasonings ============
export interface Ingredient {
  id: string;
  name: string;
  weight: number | null;
  createDate: string;
  updateDate: string;
}

export interface IngredientCreateInput {
  name: string;
  weight: number | null;
  createDate?: string;
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

export interface UserPreferences {
  apiType: ApiType;
  apiKey: string;
  apiUrl: string;
  modelName: string;
  dietaryRestrictions: string[];
  lastPersonCount?: number;
  lastMealType?: string;
  lastCaloriePreference?: number;
  thinkingEnabled: boolean;
  reasoningEffort: 'high' | 'max';
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

export interface DishPlan {
  name: string;
  ingredients: DishIngredient[];
  seasonings: DishSeasoning[];
  estimatedNutrition: DishNutrition;
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
  prepSteps?: PrepStep[];
  cookingSteps?: CookingStep[];
  preciseNutrition?: NutritionInfo[];
  ingredientTags?: IngredientTag[];
}

// ============ AI-Generated Plan ============
export interface IngredientTag {
  name: string;
  weight: number;
  color: string;
}

export interface PrepStep {
  id: string;
  ingredientName: string;
  quantity: string;
  description: string;
  dishName?: string;
  isCompleted: boolean;
  order: number;
}

export interface CookingStep {
  stepNumber: number;
  dishName: string;
  instruction: string;
  bowlReferences: number[];
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

// ============ API Related ============
export interface APIError {
  type: APIErrorType;
  statusCode: number;
  message: string;
  retryable: boolean;
  autoRetry?: boolean;
}

export type APIErrorType =
  | 'BAD_REQUEST_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'FORBIDDEN_ERROR'
  | 'NOT_FOUND_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'SERVER_ERROR'
  | 'TIMEOUT_ERROR';

// ============ Export/Import ============
export interface ExportData {
  exportVersion: number;
  exportedAt: string;
  ingredients: Ingredient[];
  seasonings: Seasoning[];
  settings: Omit<UserPreferences, 'apiKey'>;
}

export interface ImportPreview {
  newIngredients: number;
  overwriteIngredients: number;
  newSeasonings: number;
  overwriteSeasonings: number;
  willUpdateSettings: boolean;
}

export interface BackupSnapshot {
  key: string;
  importedAt: string;
  ingredientCount: number;
  seasoningCount: number;
  data: ExportData;
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
