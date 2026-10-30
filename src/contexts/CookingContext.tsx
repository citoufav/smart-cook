import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import {
  CookingState,
  CookingStage,
  RequirementInput,
  MenuProposal,
  Stage1Data,
  getStageIndex,
  STAGE_KEYS,
} from '../types';
import { VALID_TRANSITIONS } from '../constants/cooking';
import { generateId } from '../utils/uuid';
import { logger } from '../utils/logger';

type CookingAction =
  | { type: 'START_SESSION'; payload: { id: string; requirement: RequirementInput } }
  | { type: 'RESTORE_SESSION'; payload: CookingState['session'] }
  | { type: 'SET_REQUIREMENT'; payload: RequirementInput }
  | { type: 'UPDATE_REQUIREMENT'; payload: RequirementInput }
  | { type: 'SET_MENU_PROPOSAL'; payload: MenuProposal }
  | { type: 'SET_STAGE1_RESULT'; payload: Stage1Data }
  | { type: 'UPDATE_PLAN'; payload: { menuProposal: MenuProposal } }
  | { type: 'ADVANCE_STAGE'; payload: CookingStage }
  | { type: 'SET_CURRENT_STAGE'; payload: CookingStage }
  | { type: 'TOGGLE_SHOPPING_ITEM'; payload: string }
  | { type: 'RESET_SESSION' }
  | { type: 'SET_ERROR'; payload: string | null };

const log = logger('CTX:COOKING');

const INITIAL_STATE: CookingState = {
  session: null,
  error: null,
};

function cookingReducer(state: CookingState, action: CookingAction): CookingState {
  log.debug('REDUCER', { type: action.type });
  const now = new Date().toISOString();

  switch (action.type) {
    case 'START_SESSION':
      log.info('START_SESSION', { id: action.payload.id, people: action.payload.requirement.personCount, mealType: action.payload.requirement.mealType });
      return {
        ...state,
        error: null,
        session: {
          id: action.payload.id,
          status: 'requirement',
          stages: { requirement: action.payload.requirement },
          createdAt: now,
          updatedAt: now,
          version: 1,
        },
      };

    case 'RESTORE_SESSION': {
      log.info('RESTORE_SESSION', { status: action.payload?.status });
      const sess = action.payload;
      // Data migration: legacy data stored steps in stages.generatedPlan; backfill into menu.menuProposal
      // reducer 必须是纯函数：通过创建新对象迁移，不得修改传入的 session
      //（否则会同步污染列表页/进度页持有的同一对象）
      const legacyGp = (sess as any)?.stages?.generatedPlan;
      if (sess && legacyGp && sess.stages.menu?.menuProposal) {
        const mp = sess.stages.menu.menuProposal;
        const merged = {
          ...mp,
          prepSteps: mp.prepSteps?.length ? mp.prepSteps : legacyGp.prepSteps || [],
          cookingSteps: mp.cookingSteps?.length ? mp.cookingSteps : legacyGp.cookingSteps || [],
          preciseNutrition: mp.preciseNutrition?.length ? mp.preciseNutrition : legacyGp.preciseNutrition || [],
        };
        const migrated: CookingState['session'] = {
          ...sess,
          stages: { ...sess.stages, menu: { ...sess.stages.menu, menuProposal: merged } },
        };
        return { ...state, error: null, session: migrated };
      }
      return { ...state, error: null, session: sess };
    }

    case 'SET_REQUIREMENT': {
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          status: 'menu',
          stages: { ...state.session.stages, requirement: action.payload },
          updatedAt: now,
        },
      };
    }

    // 只改需求字段，**不动当前进行到哪一步**。
    // SET_REQUIREMENT 会把 status 打回 'menu'，正在炒菜时改人数就会把进度清零，所以单独一个动作。
    case 'UPDATE_REQUIREMENT': {
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          stages: { ...state.session.stages, requirement: action.payload },
          updatedAt: now,
        },
      };
    }

    case 'SET_MENU_PROPOSAL': {
      if (!state.session?.stages.menu) return state;
      return {
        ...state,
        session: {
          ...state.session,
          stages: {
            ...state.session.stages,
            menu: { ...state.session.stages.menu, menuProposal: action.payload },
          },
          updatedAt: now,
        },
      };
    }

    case 'SET_STAGE1_RESULT': {
      if (!state.session) return state;
      const mp = action.payload.menuProposal;
      log.info('SET_STAGE1_RESULT', { dishCount: mp.dishes?.length });
      return {
        ...state,
        session: {
          ...state.session,
          status: 'menu',
          stages: {
            ...state.session.stages,
            menu: action.payload,
          },
          updatedAt: now,
        },
      };
    }

    case 'UPDATE_PLAN': {
      if (!state.session) return state;
      const { menuProposal } = action.payload;
      return {
        ...state,
        session: {
          ...state.session,
          stages: {
            ...state.session.stages,
            menu: state.session.stages.menu
              ? { ...state.session.stages.menu, menuProposal: { ...state.session.stages.menu.menuProposal, ...menuProposal } }
              : state.session.stages.menu,
          },
          updatedAt: now,
        },
      };
    }

    case 'ADVANCE_STAGE': {
      if (!state.session) return state;
      const current = state.session.status;
      const targets = VALID_TRANSITIONS[current] || [];
      const canCancel = current !== 'completed' && current !== 'cancelled';
      const validTargets = action.payload === 'cancelled' && canCancel
        ? [...targets, 'cancelled']
        : targets;

      if (!validTargets.includes(action.payload)) {
        log.warn('非法阶段转换', { from: current, to: action.payload, validTargets });
        return state;
      }
      log.info('ADVANCE_STAGE', { from: current, to: action.payload });
      return {
        ...state,
        session: { ...state.session, status: action.payload, updatedAt: now },
      };
    }

    case 'SET_CURRENT_STAGE': {
      if (!state.session) return state;
      log.info('SET_CURRENT_STAGE', { from: state.session.status, to: action.payload });
      // Special-case 'completed': mark it as the final stage
      if (action.payload === 'completed') {
        return {
          ...state,
          session: {
            ...state.session,
            status: STAGE_KEYS[STAGE_KEYS.length - 1],
            updatedAt: now,
          },
        };
      }
      const targetIndex = getStageIndex(action.payload);
      // Reject non-progress stages
      if (targetIndex < 0 || targetIndex >= STAGE_KEYS.length) {
        log.warn('拒绝非进度阶段', { stage: action.payload });
        return state;
      }
      return {
        ...state,
        session: {
          ...state.session,
          status: action.payload,
          updatedAt: now,
        },
      };
    }

    case 'TOGGLE_SHOPPING_ITEM': {
      if (!state.session?.stages.menu?.menuProposal) return state;
      const missingItems = state.session.stages.menu.menuProposal.missingItems.map((item) =>
        item.id === action.payload ? { ...item, isPurchased: !item.isPurchased } : item,
      );
      return {
        ...state,
        session: {
          ...state.session,
          stages: {
            ...state.session.stages,
            menu: {
              ...state.session.stages.menu,
              menuProposal: {
                ...state.session.stages.menu.menuProposal,
                missingItems,
              },
            },
          },
          updatedAt: now,
        },
      };
    }

    case 'RESET_SESSION':
      return { ...state, session: null, error: null };

    case 'SET_ERROR':
      log.error('SET_ERROR', { error: action.payload });
      return { ...state, error: action.payload };

    default:
      return state;
  }
}

interface CookingContextValue {
  state: CookingState;
  dispatch: React.Dispatch<CookingAction>;
  startSession: (requirement: RequirementInput, id?: string) => void;
  restoreSession: (session: CookingState['session']) => void;
  setStage1Result: (data: Stage1Data) => void;
  updateRequirement: (requirement: RequirementInput) => void;
  setCurrentStage: (stage: CookingStage) => void;
  resetSession: () => void;
}

const CookingContext = createContext<CookingContextValue | null>(null);

export function CookingProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(cookingReducer, INITIAL_STATE);

  const startSession = useCallback((requirement: RequirementInput, id?: string) => {
    log.info('startSession called', { people: requirement.personCount, mealType: requirement.mealType });
    dispatch({ type: 'START_SESSION', payload: { id: id || generateId(), requirement } });
  }, []);

  const restoreSession = useCallback((session: CookingState['session']) => {
    if (session) {
      log.info('restoreSession called', { status: session.status });
      dispatch({ type: 'RESTORE_SESSION', payload: session });
    }
  }, []);

  const setStage1Result = useCallback((data: Stage1Data) => {
    log.info('setStage1Result called', { dishCount: data.menuProposal?.dishes?.length });
    dispatch({ type: 'SET_STAGE1_RESULT', payload: data });
  }, []);

  const updateRequirement = useCallback((requirement: RequirementInput) => {
    log.info('updateRequirement called', { personCount: requirement.personCount });
    dispatch({ type: 'UPDATE_REQUIREMENT', payload: requirement });
  }, []);

  const setCurrentStage = useCallback((stage: CookingStage) => {
    log.info('setCurrentStage called', { stage });
    dispatch({ type: 'SET_CURRENT_STAGE', payload: stage });
  }, []);

  const resetSession = useCallback(() => {
    log.info('resetSession called');
    dispatch({ type: 'RESET_SESSION' });
  }, []);

  // 稳定的 context value：避免每次渲染都用新对象触发全部消费者重渲染
  const value = useMemo(
    () => ({ state, dispatch, startSession, restoreSession, setStage1Result, updateRequirement, setCurrentStage, resetSession }),
    [state, dispatch, startSession, restoreSession, setStage1Result, updateRequirement, setCurrentStage, resetSession],
  );

  return (
    <CookingContext.Provider value={value}>
      {children}
    </CookingContext.Provider>
  );
}

export function useCooking() {
  const ctx = useContext(CookingContext);
  if (!ctx) throw new Error('useCooking must be used within CookingProvider');
  return ctx;
}
