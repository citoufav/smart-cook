import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { RecipeContext } from '../services/chatService';

interface ChatSheetContextValue {
  visible: boolean;
  recipeContext: RecipeContext | null;
  showChatSheet: (ctx: RecipeContext) => void;
  hideChatSheet: () => void;
}

const ChatSheetContext = createContext<ChatSheetContextValue>({
  visible: false,
  recipeContext: null,
  showChatSheet: () => {},
  hideChatSheet: () => {},
});

export function useChatSheet() {
  return useContext(ChatSheetContext);
}

export function ChatSheetProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [recipeContext, setRecipeContext] = useState<RecipeContext | null>(null);

  const showChatSheet = useCallback((ctx: RecipeContext) => {
    setRecipeContext(ctx);
    setVisible(true);
  }, []);

  const hideChatSheet = useCallback(() => {
    setVisible(false);
  }, []);

  const value = useMemo(
    () => ({ visible, recipeContext, showChatSheet, hideChatSheet }),
    [visible, recipeContext, showChatSheet, hideChatSheet],
  );

  return (
    <ChatSheetContext.Provider value={value}>
      {children}
    </ChatSheetContext.Provider>
  );
}
