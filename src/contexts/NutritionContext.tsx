import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import { NutritionState, NutritionInfo, NutritionalData } from '../types';
import { calculateTotalNutrition } from '../utils/nutrition';

type NutritionAction =
  | { type: 'SET_NUTRITION'; payload: { data: Record<string, NutritionalData>; source: string; personCount: number } }
  | { type: 'TOGGLE_DETAIL' }
  | { type: 'HIDE_BALL' }
  | { type: 'SHOW_BALL' }
  | { type: 'OPEN_SHEET' }
  | { type: 'CLOSE_SHEET' }
  | { type: 'RESET' };

const INITIAL_STATE: NutritionState = {
  nutritionByDish: {},
  dishNames: [],
  totalNutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
  personCount: 1,
  accuracy: 'none',
  isVisible: false,
  isDetailOpen: false,
  dataSource: null,
};

function nutritionReducer(state: NutritionState, action: NutritionAction): NutritionState {
  switch (action.type) {
    case 'SET_NUTRITION': {
      const dishNames = Object.keys(action.payload.data);
      const totalNutrition = calculateTotalNutrition(action.payload.data);
      console.log('[NUTRITION:CTX] SET_NUTRITION | source:', action.payload.source, '| dishNames:', dishNames, '| personCount:', action.payload.personCount);
      console.log('[NUTRITION:CTX]   totalNutrition:', JSON.stringify(totalNutrition));
      return {
        ...state,
        nutritionByDish: action.payload.data,
        dishNames,
        totalNutrition,
        personCount: action.payload.personCount,
        dataSource: action.payload.source,
        isVisible: true,
        accuracy: action.payload.source === 'precise' ? 'precise' : 'estimated',
      };
    }
    case 'TOGGLE_DETAIL':
      return { ...state, isDetailOpen: !state.isDetailOpen };
    case 'HIDE_BALL':
      return { ...state, isVisible: false, isDetailOpen: false };
    case 'SHOW_BALL':
      return { ...state, isVisible: true };
    case 'OPEN_SHEET':
      return { ...state, isDetailOpen: true };
    case 'CLOSE_SHEET':
      return { ...state, isDetailOpen: false };
    case 'RESET':
      return { ...INITIAL_STATE };
    default:
      return state;
  }
}

interface NutritionContextValue {
  state: NutritionState;
  dispatch: React.Dispatch<NutritionAction>;
  setEstimatedNutrition: (data: Record<string, NutritionalData>, personCount: number) => void;
  setPreciseNutrition: (data: Record<string, NutritionalData>, personCount: number) => void;
  hideBall: () => void;
  openSheet: () => void;
  closeSheet: () => void;
  reset: () => void;
}

const NutritionContext = createContext<NutritionContextValue | null>(null);

export function NutritionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(nutritionReducer, INITIAL_STATE);

  const setEstimatedNutrition = useCallback((data: Record<string, NutritionalData>, personCount: number) => {
    dispatch({ type: 'SET_NUTRITION', payload: { data, source: 'estimated', personCount } });
  }, []);

  const setPreciseNutrition = useCallback((data: Record<string, NutritionalData>, personCount: number) => {
    dispatch({ type: 'SET_NUTRITION', payload: { data, source: 'precise', personCount } });
  }, []);

  const openSheet = useCallback(() => dispatch({ type: 'OPEN_SHEET' }), []);
  const closeSheet = useCallback(() => dispatch({ type: 'CLOSE_SHEET' }), []);
  const hideBall = useCallback(() => dispatch({ type: 'HIDE_BALL' }), []);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return (
    <NutritionContext.Provider
      value={{ state, dispatch, setEstimatedNutrition, setPreciseNutrition, hideBall, openSheet, closeSheet, reset }}
    >
      {children}
    </NutritionContext.Provider>
  );
}

export function useNutrition() {
  const ctx = useContext(NutritionContext);
  if (!ctx) throw new Error('useNutrition must be used within NutritionProvider');
  return ctx;
}
