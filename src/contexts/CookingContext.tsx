import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import {
  CookingState,
  CookingStage,
  RequirementInput,
  MenuProposal,
  Stage1Data,
  StageMode,
  getStageIndex,
  getStageMode,
  STAGE_KEYS,
} from '../types';
import { VALID_TRANSITIONS } from '../constants/cooking';
import { generateId } from '../utils/uuid';
import { logger } from '../utils/logger';

type CookingAction =
  | { type: 'START_SESSION'; payload: { id: string; requirement: RequirementInput } }
  | { type: 'RESTORE_SESSION'; payload: CookingState['session'] }
  | { type: 'SET_REQUIREMENT'; payload: RequirementInput }
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

/** 确保旧数据也有 completedStageIndex（向后兼容迁移） */
function ensureCompletedStageIndex(session: CookingState['session']): CookingState['session'] {
  if (!session) return session;
  if (session.completedStageIndex !== undefined) return session;
  // 迁移：根据已有 stage 数据推导 (menu=0, prep=1, cooking=2)
  let idx = -1;
  const stages = session.stages;
  if (stages.menu) idx = Math.max(idx, 0);
  if (stages.menu?.menuProposal?.prepSteps) idx = Math.max(idx, 1);
  if (stages.menu?.menuProposal?.cookingSteps) idx = Math.max(idx, 2);
  // 兜底：根据 status 推断
  const statusIdx = getStageIndex(session.status);
  if (statusIdx > 0 && idx < statusIdx - 1) {
    idx = statusIdx - 1;
  }
  // 当前阶段不可被标记为已完成
  if (idx > statusIdx && statusIdx >= 0) {
    idx = statusIdx;
  }
  return { ...session, completedStageIndex: idx };
}

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
          completedStageIndex: -1,
        },
      };

    case 'RESTORE_SESSION': {
      log.info('RESTORE_SESSION', { status: action.payload?.status, completedStageIndex: action.payload?.completedStageIndex });
      const sess = ensureCompletedStageIndex(action.payload);
      // 数据迁移：旧数据把步骤存在 stages.generatedPlan，将其回填到 menu.menuProposal
      const legacyGp = (sess as any)?.stages?.generatedPlan;
      if (sess && legacyGp && sess.stages.menu?.menuProposal) {
        const mp = sess.stages.menu.menuProposal;
        const merged = {
          ...mp,
          prepSteps: mp.prepSteps?.length ? mp.prepSteps : legacyGp.prepSteps || [],
          cookingSteps: mp.cookingSteps?.length ? mp.cookingSteps : legacyGp.cookingSteps || [],
          preciseNutrition: mp.preciseNutrition?.length ? mp.preciseNutrition : legacyGp.preciseNutrition || [],
          ingredientTags: mp.ingredientTags || legacyGp.ingredientTags,
        };
        sess.stages.menu = { ...sess.stages.menu, menuProposal: merged };
        console.log('[CTX_RESTORE] 迁移旧 generatedPlan → menuProposal: prepSteps=', merged.prepSteps.length, 'cookingSteps=', merged.cookingSteps.length);
      }
      // 打印恢复的 missingItems 勾选状态
      const mi = sess?.stages?.menu?.menuProposal?.missingItems || [];
      console.log('[CTX_RESTORE] missingItems purchased:', mi.map((m: any) => ({ type: m.type, name: m.name, purchased: m.isPurchased })));
      return {
        ...state,
        error: null,
        session: sess,
      };
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
      console.log('[CTX_STAGE1] prepSteps:', mp.prepSteps?.length, 'cookingSteps:', mp.cookingSteps?.length, 'preciseNutrition:', mp.preciseNutrition?.length);
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
          completedStageIndex: 0,
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
        console.warn(`非法阶段转换: ${current} -> ${action.payload}，合法目标: ${validTargets.join(', ')}`);
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
      log.info('SET_CURRENT_STAGE', { from: state.session.status, to: action.payload, completedStageIndex: state.session.completedStageIndex });
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
      const allIds = state.session.stages.menu.menuProposal.missingItems.map((m) => ({ id: m.id, type: m.type, name: m.name }));
      const found = allIds.find((m) => m.id === action.payload);
      console.log('[TOGGLE_SHOP] payload:', action.payload, '| found:', found ? `${found.type} ${found.name}` : 'NOT FOUND', '| allIds:', JSON.stringify(allIds));
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
      log.info('restoreSession called', { status: session.status, completedStageIndex: session.completedStageIndex });
      dispatch({ type: 'RESTORE_SESSION', payload: session });
    }
  }, []);

  const setStage1Result = useCallback((data: Stage1Data) => {
    log.info('setStage1Result called', { dishCount: data.menuProposal?.dishes?.length });
    dispatch({ type: 'SET_STAGE1_RESULT', payload: data });
  }, []);

  const setCurrentStage = useCallback((stage: CookingStage) => {
    log.info('setCurrentStage called', { stage });
    dispatch({ type: 'SET_CURRENT_STAGE', payload: stage });
  }, []);

  const resetSession = useCallback(() => {
    log.info('resetSession called');
    dispatch({ type: 'RESET_SESSION' });
  }, []);

  return (
    <CookingContext.Provider
      value={{ state, dispatch, startSession, restoreSession, setStage1Result, setCurrentStage, resetSession }}
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
    const mode = getStageMode(stageIndex, Math.max(currentIndex, state.session.completedStageIndex + 1));
    log.debug('useStageMode', { stageIndex, mode, currentIndex, completedStageIndex: state.session.completedStageIndex });
    return mode;
  }, [state.session, stageIndex]);
}
