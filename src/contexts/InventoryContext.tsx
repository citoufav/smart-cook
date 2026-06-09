import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { Ingredient, Seasoning, SeasoningStatus, InventoryState } from '../types';
import { ingredientService } from '../services/ingredientService';
import { seasoningService } from '../services/seasoningService';

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
      return {
        ...state,
        [action.payload.type === 'ingredients' ? 'ingredientsLoading' : 'seasoningsLoading']: action.payload.loading,
      };
    case 'SET_INGREDIENTS':
      return { ...state, ingredients: action.payload, ingredientsLoading: false, ingredientsError: null };
    case 'ADD_INGREDIENT':
      return { ...state, ingredients: sortByCreatedAt([...state.ingredients, action.payload]) };
    case 'UPDATE_INGREDIENT':
      return {
        ...state,
        ingredients: state.ingredients.map((i) => (i.id === action.payload.id ? action.payload : i)),
      };
    case 'DELETE_INGREDIENT':
      return { ...state, ingredients: state.ingredients.filter((i) => i.id !== action.payload) };
    case 'BATCH_SET_INGREDIENTS':
      return { ...state, ingredients: sortByCreatedAt(action.payload) };
    case 'SET_SEASONINGS':
      return { ...state, seasonings: action.payload, seasoningsLoading: false, seasoningsError: null };
    case 'ADD_SEASONING':
      return { ...state, seasonings: sortByCreatedAt([...state.seasonings, action.payload]) };
    case 'UPDATE_SEASONING':
      return {
        ...state,
        seasonings: state.seasonings.map((s) => (s.id === action.payload.id ? action.payload : s)),
      };
    case 'DELETE_SEASONING':
      return { ...state, seasonings: state.seasonings.filter((s) => s.id !== action.payload) };
    case 'BATCH_SET_SEASONINGS':
      return { ...state, seasonings: sortByCreatedAt(action.payload) };
    case 'SET_ERROR':
      if (action.payload === null) {
        return { ...state, ingredientsError: null, seasoningsError: null };
      }
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
  addIngredient: (name: string, weight: number | null) => Promise<Ingredient>;
  updateIngredient: (id: string, data: { name?: string; weight?: number | null }) => Promise<Ingredient | null>;
  deleteIngredient: (id: string) => Promise<boolean>;
  addSeasoning: (name: string, status: SeasoningStatus) => Promise<Seasoning>;
  updateSeasoning: (id: string, data: { name?: string; status?: SeasoningStatus }) => Promise<Seasoning | null>;
  deleteSeasoning: (id: string) => Promise<boolean>;
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
      dispatch({ type: 'SET_INGREDIENTS', payload: ingredients });
      dispatch({ type: 'SET_SEASONINGS', payload: seasonings });
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR', payload: { type: 'ingredients', error: String(e) } });
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addIngredient = useCallback(async (name: string, weight: number | null) => {
    const ingredient = await ingredientService.add({ name, weight });
    dispatch({ type: 'ADD_INGREDIENT', payload: ingredient });
    return ingredient;
  }, []);

  const updateIngredient = useCallback(async (id: string, data: { name?: string; weight?: number | null }) => {
    const updated = await ingredientService.update(id, data);
    if (updated) dispatch({ type: 'UPDATE_INGREDIENT', payload: updated });
    return updated;
  }, []);

  const deleteIngredient = useCallback(async (id: string) => {
    const success = await ingredientService.remove(id);
    if (success) dispatch({ type: 'DELETE_INGREDIENT', payload: id });
    return success;
  }, []);

  const addSeasoning = useCallback(async (name: string, status: SeasoningStatus) => {
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
    const success = await seasoningService.remove(id);
    if (success) dispatch({ type: 'DELETE_SEASONING', payload: id });
    return success;
  }, []);

  const refreshFromStorage = useCallback(async () => {
    await loadData();
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
