// ============ 食材与调料 ============
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

// ============ 库存状态 ============
export interface InventoryState {
  ingredients: Ingredient[];
  seasonings: Seasoning[];
  ingredientsLoading: boolean;
  seasoningsLoading: boolean;
  ingredientsError: string | null;
  seasoningsError: string | null;
}

// ============ 用户设置 ============
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

// ============ 做菜需求 ============
export interface RequirementInput {
  personCount: number;
  mealType: MealType;
  caloriePreference: number | undefined;
  customRequirement: string;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'any';

// ============ 菜单方案 ============
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
}

// ============ 阶段2称量 ============
export interface IngredientWeight {
  ingredientName: string;
  estimatedWeight: number;
  actualWeight: number;
  usedInDishes: string[];
}

export interface AvailableSeasoning {
  seasoningName: string;
  seasoningId?: string;
  isAvailable: boolean;
}

export interface WeighingData {
  actualWeights: IngredientWeight[];
  availableSeasonings: AvailableSeasoning[];
}

// ============ AI生成方案 ============
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
  isCompleted: boolean;
  order: number;
}

export interface BowlAssignment {
  bowlNumber: number;
  dishName: string;
  contents: string;
  ingredients: string[];
  isCompleted: boolean;
}

export interface CookingStep {
  stepNumber: number;
  dishName: string;
  instruction: string;
  bowlReferences: number[];
  isCompleted: boolean;
}

export interface GeneratedPlan {
  prepSteps: PrepStep[];
  bowlAssignments: BowlAssignment[];
  cookingSteps: CookingStep[];
  preciseNutrition: NutritionInfo[];
  ingredientTags?: IngredientTag[];
}

// ============ 营养信息 ============
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

// ============ 库存更新 ============
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

// ============ 做菜会话 ============
export type CookingStage =
  | 'requirement'
  | 'menu'
  | 'weighing'
  | 'prep'
  | 'bowl'
  | 'cooking'
  | 'inventoryUpdate'
  | 'completed'
  | 'cancelled';

export interface Stage1Data {
  menuProposal: MenuProposal;
  requirementInput: RequirementInput;
  reasoningContent?: string;
}

export interface Stage2Data {
  weighingData: WeighingData;
  generatedPlan: GeneratedPlan;
}

export interface CookingSessionStages {
  requirement?: RequirementInput;
  menu?: Stage1Data;
  weighing?: WeighingData;
  generatedPlan?: GeneratedPlan;
}

export interface CookingSession {
  id: string;
  status: CookingStage;
  stages: CookingSessionStages;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** 0-based index of the highest completed stage (menu=0, weighing=1, prep=2, bowl=3, cooking=4). -1 means no stage completed yet */
  completedStageIndex: number;
}

export interface CookingState {
  session: CookingSession | null;
  error: string | null;
  bowlValidationRetries: number;
}

// ============ 营养Context状态 ============
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

// ============ 设置Context状态 ============
export interface SettingsState {
  preferences: UserPreferences;
  isLoading: boolean;
  error: string | null;
}

// ============ 执行进度 ============
export interface ExecutionProgress {
  sessionId: string;
  stage3Steps?: Record<string, boolean>;
  stage4Steps?: Record<string, boolean>;
  stage5Steps?: Record<string, boolean>;
  currentStage: CookingStage;
  savedAt: string;
}

export interface Stage2Progress {
  sessionId: string;
  weighedIngredients: { ingredientName: string; dishName: string; actualWeight: number }[];
  seasoningChecks: { name: string; checked: boolean }[];
  savedAt: string;
}

export interface ShoppingListProgress {
  sessionId: string;
  checkedItems: string[];
  savedAt: string;
}

// ============ API相关 ============
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

// ============ 碗验证 ============
export interface BowlValidationError {
  type: 'missing_bowl' | 'unreferenced_bowl';
  bowlNumber: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface BowlValidationResult {
  isValid: boolean;
  errors: BowlValidationError[];
  summary: {
    errorCount: number;
    warningCount: number;
  };
}

// ============ 导出/导入 ============
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

// ============ 库存检查 ============
export interface InventoryCheckResult {
  isEmpty: boolean;
  isLowInventory: boolean;
  ingredientCount: number;
}

// ============ Stage2 AI Input ============
export interface Stage2AIInput {
  dishes: {
    name: string;
    ingredients: { name: string; actualGrams: number }[];
  }[];
  availableSeasonings: string[];
  peopleCount: number;
  mealType: string;
  calorieTarget: number | undefined;
}

// ============ Stage2 AI Response ============
export interface Stage2AIResponse {
  prepSteps: PrepStep[];
  bowlAssignments: BowlAssignment[];
  cookingSteps: CookingStep[];
  preciseNutrition: NutritionInfo[];
}

// ============ 阶段模式（三状态模型） ============
/** 页面所处的模式：locked=未开始不可查看，readonly=已完成只读，interactive=进行中可操作 */
export type StageMode = 'locked' | 'readonly' | 'interactive';

/** 做菜阶段索引（0-4），对应菜单→称量→备菜→分装→制作 */
export const STAGE_INDEX_MAP: Record<string, number> = {
  menu: 0,
  weighing: 1,
  prep: 2,
  bowl: 3,
  cooking: 4,
};

export const STAGE_KEYS: CookingStage[] = ['menu', 'weighing', 'prep', 'bowl', 'cooking'];

/** 根据 CookingStage 获取 0-based 索引 */
export function getStageIndex(stage: CookingStage): number {
  return STAGE_INDEX_MAP[stage] ?? -1;
}

/** 根据索引获取 CookingStage */
export function getStageKeyByIndex(index: number): CookingStage {
  return STAGE_KEYS[index] || 'menu';
}

/** 根据 stage 索引和当前进度计算阶段模式 */
export function getStageMode(stageIndex: number, currentStageIndex: number): StageMode {
  if (stageIndex < currentStageIndex) return 'readonly';
  if (stageIndex === currentStageIndex) return 'interactive';
  return 'locked';
}
