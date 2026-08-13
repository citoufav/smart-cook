import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { Ingredient, Seasoning, SeasoningStatus, InventoryState } from '../types';
import { ingredientService } from '../services/ingredientService';
import { seasoningService } from '../services/seasoningService';
import { generateId } from '../utils/uuid';
import { logger } from '../utils/logger';

// Actions
type InventoryAction =
  | { type: 'SET_INGREDIENTS'; payload: Ingredient[] }
  | { type: 'ADD_INGREDIENT'; payload: Ingredient }
  | { type: 'UPDATE_INGREDIENT'; payload: Ingredient }
  | { type: 'DELETE_INGREDIENT'; payload: string }
  | { type: 'BATCH_SET_INGREDIENTS'; payload: Ingredient[] }
  | { type: 'SET_SEASONINGS'; payload: Seasoning[] }
  | { type: 'ADD_SEASONING'; payload: Seasoning }
  | { type: 'UPDATE_SEASONING'; payload: Seasoning }
  | { type: 'DELETE_SEASONING'; payload: string }
  | { type: 'BATCH_SET_SEASONINGS'; payload: Seasoning[] }
  | { type: 'SET_LOADING'; payload: { type: 'ingredients' | 'seasonings'; loading: boolean } }
  | { type: 'SET_ERROR'; payload: { type: 'ingredients' | 'seasonings'; error: string } | null };

const log = logger('CTX:INVENTORY');

const INITIAL_STATE: InventoryState = {
  ingredients: [],
  seasonings: [],
  ingredientsLoading: true,
  seasoningsLoading: true,
  ingredientsError: null,
  seasoningsError: null,
};

function sortByCreatedAt<T extends { createDate: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => new Date(a.createDate).getTime() - new Date(b.createDate).getTime());
}

function inventoryReducer(state: InventoryState, action: InventoryAction): InventoryState {
  switch (action.type) {
    case 'SET_LOADING':
      log.debug('SET_LOADING', { type: action.payload.type, loading: action.payload.loading });
      return {
        ...state,
        [action.payload.type === 'ingredients' ? 'ingredientsLoading' : 'seasoningsLoading']: action.payload.loading,
      };
    case 'SET_INGREDIENTS':
      log.debug('SET_INGREDIENTS', { count: action.payload.length });
      return { ...state, ingredients: action.payload, ingredientsLoading: false, ingredientsError: null };
    case 'ADD_INGREDIENT':
      log.info('ADD_INGREDIENT', { name: action.payload.name, totalCount: state.ingredients.length + 1 });
      return { ...state, ingredients: sortByCreatedAt([...state.ingredients, action.payload]) };
    case 'UPDATE_INGREDIENT':
      return {
        ...state,
        ingredients: state.ingredients.map((i) => (i.id === action.payload.id ? action.payload : i)),
      };
    case 'DELETE_INGREDIENT':
      log.info('DELETE_INGREDIENT', { id: action.payload, remainingCount: state.ingredients.length - 1 });
      return { ...state, ingredients: state.ingredients.filter((i) => i.id !== action.payload) };
    case 'BATCH_SET_INGREDIENTS':
      return { ...state, ingredients: sortByCreatedAt(action.payload) };
    case 'SET_SEASONINGS':
      log.debug('SET_SEASONINGS', { count: action.payload.length });
      return { ...state, seasonings: action.payload, seasoningsLoading: false, seasoningsError: null };
    case 'ADD_SEASONING':
      log.info('ADD_SEASONING', { name: action.payload.name, totalCount: state.seasonings.length + 1 });
      return { ...state, seasonings: sortByCreatedAt([...state.seasonings, action.payload]) };
    case 'UPDATE_SEASONING':
      return {
        ...state,
        seasonings: state.seasonings.map((s) => (s.id === action.payload.id ? action.payload : s)),
      };
    case 'DELETE_SEASONING':
      log.info('DELETE_SEASONING', { id: action.payload, remainingCount: state.seasonings.length - 1 });
      return { ...state, seasonings: state.seasonings.filter((s) => s.id !== action.payload) };
    case 'BATCH_SET_SEASONINGS':
      return { ...state, seasonings: sortByCreatedAt(action.payload) };
    case 'SET_ERROR':
      if (action.payload === null) {
        return { ...state, ingredientsError: null, seasoningsError: null };
      }
      log.error('SET_ERROR', { type: action.payload.type, error: action.payload.error });
      return {
        ...state,
        [action.payload.type === 'ingredients' ? 'ingredientsError' : 'seasoningsError']: action.payload.error,
      };
    default:
      return state;
  }
}

interface InventoryContextValue {
  state: InventoryState;
  dispatch: React.Dispatch<InventoryAction>;
  addIngredient: (name: string, weight: number | null, createDate?: string) => Promise<Ingredient>;
  updateIngredient: (id: string, data: { name?: string; weight?: number | null; createDate?: string }) => Promise<Ingredient | null>;
  deleteIngredient: (id: string) => Promise<boolean>;
  addSeasoning: (name: string, status: SeasoningStatus) => Promise<Seasoning>;
  updateSeasoning: (id: string, data: { name?: string; status?: SeasoningStatus }) => Promise<Seasoning | null>;
  deleteSeasoning: (id: string) => Promise<boolean>;
  exportInventoryJson: () => string;
  importInventoryJson: (json: string) => Promise<void>;
  refreshFromStorage: () => Promise<void>;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

export function InventoryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(inventoryReducer, INITIAL_STATE);

  const loadData = useCallback(async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: { type: 'ingredients', loading: true } });
      dispatch({ type: 'SET_LOADING', payload: { type: 'seasonings', loading: true } });
      const [ingredients, seasonings] = await Promise.all([
        ingredientService.getAll(),
        seasoningService.getAll(),
      ]);
      log.info('loadData complete', { ingredientCount: ingredients.length, seasoningCount: seasonings.length });
      dispatch({ type: 'SET_INGREDIENTS', payload: ingredients });
      dispatch({ type: 'SET_SEASONINGS', payload: seasonings });
    } catch (e: any) {
      log.error('loadData failed', { error: String(e) });
      dispatch({ type: 'SET_ERROR', payload: { type: 'ingredients', error: String(e) } });
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addIngredient = useCallback(async (name: string, weight: number | null, createDate?: string) => {
    log.info('addIngredient called', { name, weight });
    const ingredient = await ingredientService.add({ name, weight, createDate });
    dispatch({ type: 'ADD_INGREDIENT', payload: ingredient });
    return ingredient;
  }, []);

  const updateIngredient = useCallback(async (id: string, data: { name?: string; weight?: number | null; createDate?: string }) => {
    const updated = await ingredientService.update(id, data);
    if (updated) dispatch({ type: 'UPDATE_INGREDIENT', payload: updated });
    return updated;
  }, []);

  const deleteIngredient = useCallback(async (id: string) => {
    log.info('deleteIngredient called', { id });
    const success = await ingredientService.remove(id);
    if (success) dispatch({ type: 'DELETE_INGREDIENT', payload: id });
    return success;
  }, []);

  const addSeasoning = useCallback(async (name: string, status: SeasoningStatus) => {
    log.info('addSeasoning called', { name, status });
    const seasoning = await seasoningService.add({ name, status });
    dispatch({ type: 'ADD_SEASONING', payload: seasoning });
    return seasoning;
  }, []);

  const updateSeasoning = useCallback(async (id: string, data: { name?: string; status?: SeasoningStatus }) => {
    const updated = await seasoningService.update(id, data);
    if (updated) dispatch({ type: 'UPDATE_SEASONING', payload: updated });
    return updated;
  }, []);

  const deleteSeasoning = useCallback(async (id: string) => {
    log.info('deleteSeasoning called', { id });
    const success = await seasoningService.remove(id);
    if (success) dispatch({ type: 'DELETE_SEASONING', payload: id });
    return success;
  }, []);

  const refreshFromStorage = useCallback(async () => {
    await loadData();
  }, [loadData]);

  const exportInventoryJson = useCallback((): string => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      ingredients: state.ingredients,
      seasonings: state.seasonings,
    };
    return JSON.stringify(data, null, 2);
  }, [state.ingredients, state.seasonings]);

  const importInventoryJson = useCallback(async (json: string): Promise<void> => {
    const data = JSON.parse(json);
    if (!data || !Array.isArray(data.ingredients) || !Array.isArray(data.seasonings)) {
      throw new Error('无效的库存数据格式');
    }
    // Append mode: only add ingredients not already in inventory; skip same-name ones
    const existingIngredients = await ingredientService.getAll();
    const existingNames = new Set(existingIngredients.map((i) => i.name));
    let addedCount = 0;
    for (const i of data.ingredients) {
      const name = String(i.name || '').trim();
      if (!name || existingNames.has(name)) continue;
      await ingredientService.add({ name, weight: typeof i.weight === 'number' ? i.weight : null, createDate: i.createDate });
      existingNames.add(name);
      addedCount++;
    }
    // Append seasonings
    const existingSeasonings = await seasoningService.getAll();
    const existingSeasoningNames = new Set(existingSeasonings.map((s) => s.name));
    let addedSeasoningCount = 0;
    for (const s of data.seasonings) {
      const name = String(s.name || '').trim();
      if (!name || existingSeasoningNames.has(name)) continue;
      await seasoningService.add({ name, status: (['sufficient', 'low', 'out'].includes(s.status) ? s.status : 'sufficient') as SeasoningStatus });
      existingSeasoningNames.add(name);
      addedSeasoningCount++;
    }
    await loadData();
    // Report import results via console.log
    console.log(`[IMPORT] 已添加食材 ${addedCount} 个，调料 ${addedSeasoningCount} 个（跳过已存在的同名项）`);
  }, [loadData]);

  return (
    <InventoryContext.Provider
      value={{
        state,
        dispatch,
        addIngredient,
        updateIngredient,
        deleteIngredient,
        addSeasoning,
        updateSeasoning,
        deleteSeasoning,
        exportInventoryJson,
        importInventoryJson,
        refreshFromStorage,
      }}
    >
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error('useInventory must be used within InventoryProvider');
  return ctx;
}
