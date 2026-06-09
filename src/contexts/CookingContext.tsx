import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import {
  CookingState,
  CookingStage,
  RequirementInput,
  MenuProposal,
  Stage1Data,
  WeighingData,
  GeneratedPlan,
  StageMode,
  getStageIndex,
  getStageMode,
  STAGE_KEYS,
} from '../types';
import { VALID_TRANSITIONS, MAX_RETRY_COUNT } from '../constants/cooking';
import { generateId } from '../utils/uuid';

type CookingAction =
  | { type: 'START_SESSION'; payload: { id: string; requirement: RequirementInput } }
  | { type: 'RESTORE_SESSION'; payload: CookingState['session'] }
  | { type: 'SET_REQUIREMENT'; payload: RequirementInput }
  | { type: 'SET_MENU_PROPOSAL'; payload: MenuProposal }
  | { type: 'SET_STAGE1_RESULT'; payload: Stage1Data }
  | { type: 'SET_STAGE2_RESULT'; payload: { weighingData: WeighingData; generatedPlan: GeneratedPlan } }
  | { type: 'SET_GENERATED_PLAN'; payload: GeneratedPlan }
  | { type: 'TOGGLE_PREP_STEP'; payload: string }
  | { type: 'COMPLETE_ALL_PREP' }
  | { type: 'TOGGLE_BOWL'; payload: number }
  | { type: 'COMPLETE_ALL_BOWLS' }
  | { type: 'TOGGLE_COOKING_STEP'; payload: string }
  | { type: 'COMPLETE_ALL_COOKING_STEPS' }
  | { type: 'ADVANCE_STAGE'; payload: CookingStage }
  | { type: 'SET_CURRENT_STAGE'; payload: CookingStage }
  | { type: 'TOGGLE_SHOPPING_ITEM'; payload: string }
  | { type: 'INCREMENT_RETRY' }
  | { type: 'RESET_RETRY' }
  | { type: 'RESET_SESSION' }
  | { type: 'SET_ERROR'; payload: string | null };

const INITIAL_STATE: CookingState = {
  session: null,
  error: null,
  bowlValidationRetries: 0,
};

/** 确保旧数据也有 completedStageIndex（向后兼容迁移） */
function ensureCompletedStageIndex(session: CookingState['session']): CookingState['session'] {
  if (!session) return session;
  if (session.completedStageIndex !== undefined) return session;
  // 迁移：根据 status 和已有 stage 数据推导
  let idx = -1;
  const stages = session.stages;
  if (stages.menu) idx = Math.max(idx, 0);
  if (stages.weighing || stages.generatedPlan?.prepSteps) idx = Math.max(idx, 1);
  const bowlAssignments = stages.generatedPlan?.bowlAssignments;
  if (bowlAssignments && bowlAssignments.length > 0 && bowlAssignments.every((b) => b.isCompleted)) idx = Math.max(idx, 3);
  const cookingSteps = stages.generatedPlan?.cookingSteps;
  if (cookingSteps && cookingSteps.length > 0 && cookingSteps.every((s) => s.isCompleted)) idx = Math.max(idx, 4);
  // 兜底：根据 status 推断
  const statusIdx = getStageIndex(session.status);
  if (statusIdx > 0 && idx < statusIdx - 1) {
    idx = statusIdx - 1;
  }
  // 当前阶段不可被标记为已完成
  if (idx > statusIdx && statusIdx >= 0) {
    idx = statusIdx;
  }
  // console.log('[CTX] ensureCompletedStageIndex 迁移 | status=', session.status, '| statusIdx=', statusIdx, '| derived completedIdx=', idx);
  return { ...session, completedStageIndex: idx };
}

function cookingReducer(state: CookingState, action: CookingAction): CookingState {
  const now = new Date().toISOString();

  switch (action.type) {
    case 'START_SESSION':
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
          completedStageIndex: -1,
        },
      };

    case 'RESTORE_SESSION':
      // console.log('[CTX] RESTORE_SESSION | status=', action.payload?.status, '| saved completedIdx=', action.payload?.completedStageIndex);
      return {
        ...state,
        error: null,
        bowlValidationRetries: 0,
        session: ensureCompletedStageIndex(action.payload),
      };

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
      // console.log('[CTX] SET_STAGE1_RESULT | status=menu | prev completedIdx=', state.session.completedStageIndex);
      return {
        ...state,
        session: {
          ...state.session,
          status: 'menu',
          stages: { ...state.session.stages, menu: action.payload },
          updatedAt: now,
          // 菜单尚未确认，completedStageIndex 保持 -1
          completedStageIndex: state.session.completedStageIndex,
        },
      };
    }

    case 'SET_STAGE2_RESULT': {
      if (!state.session) return state;
      // console.log('[CTX] SET_STAGE2_RESULT | status=prep | completedIdx=1');
      return {
        ...state,
        session: {
          ...state.session,
          status: 'prep',
          stages: {
            ...state.session.stages,
            weighing: action.payload.weighingData,
            generatedPlan: action.payload.generatedPlan,
          },
          updatedAt: now,
          completedStageIndex: 1,
        },
      };
    }

    case 'SET_GENERATED_PLAN': {
      if (!state.session) return state;
      return {
        ...state,
        bowlValidationRetries: 0,
        session: {
          ...state.session,
          status: 'prep',
          stages: { ...state.session.stages, generatedPlan: action.payload },
          updatedAt: now,
        },
      };
    }

    case 'TOGGLE_PREP_STEP': {
      if (!state.session?.stages.generatedPlan) return state;
      const prepSteps = state.session.stages.generatedPlan.prepSteps.map((s) =>
        s.id === action.payload ? { ...s, isCompleted: !s.isCompleted } : s,
      );
      return {
        ...state,
        session: {
          ...state.session,
          stages: {
            ...state.session.stages,
            generatedPlan: { ...state.session.stages.generatedPlan, prepSteps },
          },
          updatedAt: now,
        },
      };
    }

    case 'COMPLETE_ALL_PREP': {
      if (!state.session?.stages.generatedPlan) return state;
      // console.log('[CTX] COMPLETE_ALL_PREP | status=bowl | completedIdx=2');
      const prepSteps = state.session.stages.generatedPlan.prepSteps.map((s) => ({
        ...s,
        isCompleted: true,
      }));
      return {
        ...state,
        session: {
          ...state.session,
          status: 'bowl',
          stages: {
            ...state.session.stages,
            generatedPlan: { ...state.session.stages.generatedPlan, prepSteps },
          },
          updatedAt: now,
          completedStageIndex: 2,
        },
      };
    }

    case 'TOGGLE_BOWL': {
      if (!state.session?.stages.generatedPlan) return state;
      const bowlAssignments = state.session.stages.generatedPlan.bowlAssignments.map((b) =>
        b.bowlNumber === action.payload ? { ...b, isCompleted: !b.isCompleted } : b,
      );
      return {
        ...state,
        session: {
          ...state.session,
          stages: {
            ...state.session.stages,
            generatedPlan: { ...state.session.stages.generatedPlan, bowlAssignments },
          },
          updatedAt: now,
        },
      };
    }

    case 'COMPLETE_ALL_BOWLS': {
      if (!state.session?.stages.generatedPlan) return state;
      // console.log('[CTX] COMPLETE_ALL_BOWLS | status=cooking | completedIdx=3');
      const bowlAssignments = state.session.stages.generatedPlan.bowlAssignments.map((b) => ({
        ...b,
        isCompleted: true,
      }));
      return {
        ...state,
        session: {
          ...state.session,
          status: 'cooking',
          stages: {
            ...state.session.stages,
            generatedPlan: { ...state.session.stages.generatedPlan, bowlAssignments },
          },
          updatedAt: now,
          completedStageIndex: 3,
        },
      };
    }

    case 'TOGGLE_COOKING_STEP': {
      if (!state.session?.stages.generatedPlan) return state;
      const cookingSteps = state.session.stages.generatedPlan.cookingSteps.map((s) =>
        String(s.stepNumber) === action.payload ? { ...s, isCompleted: !s.isCompleted } : s,
      );
      return {
        ...state,
        session: {
          ...state.session,
          stages: {
            ...state.session.stages,
            generatedPlan: { ...state.session.stages.generatedPlan, cookingSteps },
          },
          updatedAt: now,
        },
      };
    }

    case 'COMPLETE_ALL_COOKING_STEPS': {
      if (!state.session?.stages.generatedPlan) return state;
      // console.log('[CTX] COMPLETE_ALL_COOKING_STEPS | status=inventoryUpdate | completedIdx=4');
      const cookingSteps = state.session.stages.generatedPlan.cookingSteps.map((s) => ({
        ...s,
        isCompleted: true,
      }));
      return {
        ...state,
        session: {
          ...state.session,
          status: 'inventoryUpdate',
          stages: {
            ...state.session.stages,
            generatedPlan: { ...state.session.stages.generatedPlan, cookingSteps },
          },
          updatedAt: now,
          completedStageIndex: 4,
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
        console.warn(`非法阶段转换: ${current} -> ${action.payload}，合法目标: ${validTargets.join(', ')}`);
        return state;
      }
      return {
        ...state,
        session: { ...state.session, status: action.payload, updatedAt: now },
      };
    }

    case 'SET_CURRENT_STAGE': {
      if (!state.session) return state;
      // 特殊处理 'completed'：标记所有阶段完成
      if (action.payload === 'completed') {
        return {
          ...state,
          session: {
            ...state.session,
            status: STAGE_KEYS[STAGE_KEYS.length - 1],
            completedStageIndex: STAGE_KEYS.length - 1,
            updatedAt: now,
          },
        };
      }
      const targetIndex = getStageIndex(action.payload);
      const currentCompleted = state.session.completedStageIndex;
      console.log('[CTX] SET_CURRENT_STAGE | payload:', action.payload, '| targetIdx:', targetIndex, '| currentCompletedIdx:', currentCompleted, '| currentStatus:', state.session.status);
      // 拒绝非进度阶段
      if (targetIndex < 0 || targetIndex >= STAGE_KEYS.length) {
        console.log('[CTX] → 拒绝：非进度阶段');
        return state;
      }
      // 允许跳转（包括回退到已完成阶段，进度条已做 maxAccessible 拦截）
      console.log('[CTX] → 允许，new completedIdx=', Math.max(currentCompleted, targetIndex - 1));
      return {
        ...state,
        session: {
          ...state.session,
          status: action.payload,
          completedStageIndex: Math.max(currentCompleted, targetIndex - 1),
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

    case 'INCREMENT_RETRY':
      return { ...state, bowlValidationRetries: Math.min(state.bowlValidationRetries + 1, MAX_RETRY_COUNT) };

    case 'RESET_RETRY':
      return { ...state, bowlValidationRetries: 0 };

    case 'RESET_SESSION':
      return { ...state, session: null, error: null, bowlValidationRetries: 0 };

    case 'SET_ERROR':
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
  setStage2Result: (weighingData: WeighingData, generatedPlan: GeneratedPlan) => void;
  setCurrentStage: (stage: CookingStage) => void;
  resetSession: () => void;
}

const CookingContext = createContext<CookingContextValue | null>(null);

export function CookingProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(cookingReducer, INITIAL_STATE);

  const startSession = useCallback((requirement: RequirementInput, id?: string) => {
    dispatch({ type: 'START_SESSION', payload: { id: id || generateId(), requirement } });
  }, []);

  const restoreSession = useCallback((session: CookingState['session']) => {
    if (session) {
      dispatch({ type: 'RESTORE_SESSION', payload: session });
    }
  }, []);

  const setStage1Result = useCallback((data: Stage1Data) => {
    dispatch({ type: 'SET_STAGE1_RESULT', payload: data });
  }, []);

  const setStage2Result = useCallback((weighingData: WeighingData, generatedPlan: GeneratedPlan) => {
    dispatch({ type: 'SET_STAGE2_RESULT', payload: { weighingData, generatedPlan } });
  }, []);

  const setCurrentStage = useCallback((stage: CookingStage) => {
    dispatch({ type: 'SET_CURRENT_STAGE', payload: stage });
  }, []);

  const resetSession = useCallback(() => {
    dispatch({ type: 'RESET_SESSION' });
  }, []);

  return (
    <CookingContext.Provider
      value={{ state, dispatch, startSession, restoreSession, setStage1Result, setStage2Result, setCurrentStage, resetSession }}
    >
      {children}
    </CookingContext.Provider>
  );
}

export function useCooking() {
  const ctx = useContext(CookingContext);
  if (!ctx) throw new Error('useCooking must be used within CookingProvider');
  return ctx;
}

/** 获取指定 stage 索引的 StageMode */
export function useStageMode(stageIndex: number): StageMode {
  const { state } = useCooking();
  return useMemo(() => {
    if (!state.session) return 'locked';
    const currentIndex = getStageIndex(state.session.status);
    return getStageMode(stageIndex, Math.max(currentIndex, state.session.completedStageIndex + 1));
  }, [state.session, stageIndex]);
}
