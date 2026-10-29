import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';

interface ChatBallContextValue {
  visible: boolean;
  showChatBall: () => void;
  hideChatBall: () => void;
  onChatPress: (() => void) | null;
  setOnChatPress: (handler: (() => void) | null) => void;
  /** Set the press handler via ref to avoid triggering re-renders */
  setOnChatPressRef: (handler: (() => void) | null) => void;
}

const ChatBallContext = createContext<ChatBallContextValue>({
  visible: false,
  showChatBall: () => {},
  hideChatBall: () => {},
  onChatPress: null,
  setOnChatPress: () => {},
  setOnChatPressRef: () => {},
});

export function useChatBall() {
  return useContext(ChatBallContext);
}

export function ChatBallProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [onChatPress, setOnChatPress] = useState<(() => void) | null>(null);
  const pressRef = useRef<(() => void) | null>(null);

  const showChatBall = useCallback(() => setVisible(true), []);
  const hideChatBall = useCallback(() => {
    setVisible(false);
    setOnChatPress(null);
    pressRef.current = null;
  }, []);

  const setOnChatPressRef = useCallback((handler: (() => void) | null) => {
    pressRef.current = handler;
  }, []);

  const value = useMemo(
    () => ({
      visible,
      showChatBall,
      hideChatBall,
      onChatPress: onChatPress || pressRef.current,
      setOnChatPress,
      setOnChatPressRef,
    }),
    [visible, onChatPress, showChatBall, hideChatBall, setOnChatPress, setOnChatPressRef],
  );

  return (
    <ChatBallContext.Provider value={value}>
      {children}
    </ChatBallContext.Provider>
  );
}
