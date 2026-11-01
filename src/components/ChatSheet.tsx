import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Animated,
  useWindowDimensions,
  Keyboard,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { SPACING, BORDER_RADIUS } from '../constants/spacing';
import { useSettings } from '../contexts/SettingsContext';
import { useCooking } from '../contexts/CookingContext';
import { callAIChatStream, RecipeContext } from '../services/chatService';
import { saveChat, loadChat, estimateTokens } from '../services/chatHistoryService';
import { SSEStreamController } from '../utils/sseStream';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoningContent?: string;
  /** system 消息是否要以 assistant 身份回灌给模型（工具执行结果这类） */
  sendAsAssistant?: boolean;
}

interface ChatSheetProps {
  visible: boolean;
  onClose: () => void;
  recipeContext: RecipeContext;
}

export default function ChatSheet({ visible, onClose, recipeContext }: ChatSheetProps) {
  const { state: settingsState } = useSettings();
  const { state: cookingState } = useCooking();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [expandedReasonings, setExpandedReasonings] = useState<Set<string>>(new Set());
  const flatListRef = useRef<FlatList>(null);
  const isNearBottomRef = useRef(true);
  const streamRef = useRef<SSEStreamController | null>(null);
  const pendingAssistantRef = useRef<string>('');
  const pendingReasoningRef = useRef<string>('');
  const prevTotalLinesRef = useRef(0); // Throttle: only trigger scroll when lines change

  // 消息列表的同步镜像：供回调读取最新消息，避免在 setMessages updater 里执行副作用
  //（updater 必须是纯函数，StrictMode 下会被重复调用）
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const lastUiFlushRef = useRef(0); // 流式 UI 节流时间戳

  const slideAnim = useRef(new Animated.Value(screenHeight)).current;

  const sessionId = cookingState.session?.id || recipeContext.sessionId || 'default';

  // 菜谱上下文必须**每次发送时现取**，不能用打开面板那一刻的快照：
  // 面板开着期间用户可能已经在菜谱页改过菜，拿旧快照会让模型答的是过期菜谱。
  const liveRecipeContext: RecipeContext = React.useMemo(() => {
    const mp = cookingState.session?.stages?.menu?.menuProposal;
    return { dishes: mp?.dishes || [], sessionId };
  }, [cookingState.session, sessionId]);

  const scrollToBottom = useCallback((force: boolean = false) => {
    if (!force && !isNearBottomRef.current) return;
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 50);
  }, []);

  const handleScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    isNearBottomRef.current = distanceFromBottom < 60;
  }, []);

  // Keyboard listeners
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      scrollToBottom(true);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Load chat history
  useEffect(() => {
    if (visible && sessionId !== 'default') {
      loadChat(sessionId).then((session) => {
        if (session && session.messages.length > 0) {
          const loaded: ChatMessage[] = session.messages.map((m, i) => ({
            id: `${m.role}-${i}-${Date.now()}`,
            role: m.role,
            content: m.content,
            reasoningContent: (m as any).reasoningContent,
          }));
          setMessages(loaded);
        } else {
          setMessages([]);
        }
      }).catch(() => setMessages([]));
    } else {
      setMessages([]);
    }
    setExpandedReasonings(new Set());
  }, [visible, sessionId]);

  // Persist chat history
  const persistMessages = useCallback((msgs: ChatMessage[]) => {
    if (sessionId === 'default') return;
    const plain = msgs
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content, reasoningContent: m.reasoningContent }));
    saveChat(sessionId, plain).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (visible) {
      setErrorMsg(null);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start();
    } else {
      streamRef.current?.abort();
      streamRef.current = null;
      Animated.timing(slideAnim, {
        toValue: screenHeight,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, screenHeight, slideAnim]);

  const contextTokens = (() => {
    const allText = messages.map((m) => m.content + (m.reasoningContent || '')).join('');
    return estimateTokens(allText);
  })();

  const toggleReasoning = useCallback((msgId: string) => {
    setExpandedReasonings((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  }, []);

  const sendMessage = useCallback(() => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInputText('');
    setErrorMsg(null);
    setIsLoading(true);
    scrollToBottom(true);

    // 发送给 API 前：
    // - 纯本地状态提示（确认/取消）过滤掉
    // - 工具执行结果（sendAsAssistant）以 assistant 身份回灌，否则模型不知道自己刚改了什么
    const chatMessages = nextMessages
      .filter((m) => m.role !== 'system' || m.sendAsAssistant)
      .map((m) => ({
        role: (m.role === 'system' ? 'assistant' : m.role) as 'user' | 'assistant',
        content: m.content,
      }));

    const assistantId = `assistant-${Date.now()}`;
    pendingAssistantRef.current = '';
    pendingReasoningRef.current = '';
    prevTotalLinesRef.current = 0;
    lastUiFlushRef.current = 0;

    // 流式 UI 节流：80ms 刷新一次消息气泡，避免每个 SSE chunk 都触发整列表渲染；
    // onDone 时会用最终文本做一次权威覆盖，无需额外收尾刷新
    const flushAssistantToUi = () => {
      const now = Date.now();
      if (now - lastUiFlushRef.current < 80) return;
      lastUiFlushRef.current = now;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.id === assistantId) {
          return [...prev.slice(0, -1), {
            ...last,
            content: pendingAssistantRef.current,
            reasoningContent: pendingReasoningRef.current || undefined,
          }];
        }
        return [...prev, {
          id: assistantId,
          role: 'assistant',
          content: pendingAssistantRef.current,
          reasoningContent: pendingReasoningRef.current || undefined,
        }];
      });
      const totalLines = (pendingReasoningRef.current + pendingAssistantRef.current).split('\n').length;
      if (totalLines !== prevTotalLinesRef.current) {
        prevTotalLinesRef.current = totalLines;
        scrollToBottom();
      }
    };

    const stream = callAIChatStream(
      liveRecipeContext,
      chatMessages,
      settingsState.preferences,
      {
        onReasoning: (token: string) => {
          pendingReasoningRef.current += token;
          flushAssistantToUi();
        },
        onToken: (token: string) => {
          pendingAssistantRef.current += token;
          flushAssistantToUi();
        },
        onDone: (fullText: string) => {
          setIsLoading(false);
          streamRef.current = null;
          scrollToBottom();
          // 用最终文本构造完整消息列表：在 updater 之外持久化（updater 必须是纯函数）
          const finalList: ChatMessage[] = [
            ...nextMessages,
            {
              id: assistantId,
              role: 'assistant',
              content: fullText,
              reasoningContent: pendingReasoningRef.current || undefined,
            },
          ];
          setMessages(finalList);
          persistMessages(finalList);
        },
        onError: (error: Error) => {
          setIsLoading(false);
          streamRef.current = null;
          setErrorMsg(error.message || '发送失败，请重试');
        },
      },
    );

    streamRef.current = stream;
  }, [inputText, isLoading, messages, liveRecipeContext, settingsState.preferences, scrollToBottom, persistMessages]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    const isSystem = item.role === 'system';
    const hasReasoning = !isUser && !isSystem && item.reasoningContent && item.reasoningContent.length > 0;
    const hasContent = item.content.length > 0;
    const reasoningExpanded = expandedReasonings.has(item.id);

    // System message（工具执行结果 / 状态提示）
    if (isSystem) {
      return (
        <View style={styles.systemRow}>
          <View style={styles.systemBubble}>
            <Text style={styles.systemText}>{item.content}</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAssistant]}>
        <View style={{ maxWidth: '80%' }}>
          {/* Reasoning chain — shown only for AI messages with reasoning content */}
          {hasReasoning && (
            <TouchableOpacity
              style={styles.reasoningToggle}
              onPress={() => toggleReasoning(item.id)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={reasoningExpanded ? 'chevron-down' : 'chevron-forward'}
                size={14}
                color={COLORS.primary}
              />
              <Text style={styles.reasoningToggleText}>
                {reasoningExpanded ? '收起思考' : '查看 AI 思考'}
              </Text>
              {!hasContent && (
                <Text style={styles.reasoningLiveHint}>思考中...</Text>
              )}
            </TouchableOpacity>
          )}
          {hasReasoning && reasoningExpanded && (
            <View style={styles.reasoningBox}>
              <Text style={styles.reasoningText}>{item.reasoningContent}</Text>
            </View>
          )}
          {/* Content bubble — shown only when there is content */}
          {hasContent && (
            <View style={[styles.msgBubble, isUser ? styles.msgBubbleUser : styles.msgBubbleAssistant]}>
              <Text style={[styles.msgText, isUser ? styles.msgTextUser : styles.msgTextAssistant]}>
                {item.content}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }, [expandedReasonings, toggleReasoning]);

  if (!visible) return null;

  const panelHeight = screenHeight * 0.55;

  return (
    <View style={styles.overlayContainer}>
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      />
      <Animated.View
        style={[
          styles.panel,
          {
            height: panelHeight,
            paddingBottom: insets.bottom,
            marginBottom: keyboardHeight,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerHandle} />
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>菜谱助手</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>有什么想知道的，问我</Text>
          </View>
          {messages.length > 0 && (
            <Text style={styles.ctxHint}>
              上下文约 {Math.round(contextTokens / 1000)}K / 200K tokens
            </Text>
          )}
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          style={styles.msgList}
          contentContainerStyle={styles.msgListContent}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (messages.length > 0) scrollToBottom();
          }}
          ListEmptyComponent={
            <Text style={styles.emptyHint}>有什么关于菜谱的问题，随时问我</Text>
          }
        />

        {errorMsg && (
          <View style={styles.errorRow}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="输入你的问题..."
            placeholderTextColor={COLORS.textTertiary}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
            editable={!isLoading}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || isLoading) && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!inputText.trim() || isLoading}
            activeOpacity={0.7}
          >
            <Ionicons
              name="send"
              size={20}
              color={inputText.trim() && !isLoading ? COLORS.textWhite : COLORS.textTertiary}
            />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1001,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.overlay || 'rgba(0,0,0,0.5)',
  },
  panel: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    alignItems: 'center',
  },
  headerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  headerTitle: {
    fontSize: TYPOGRAPHY.h4,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  switchLabel: {
    fontSize: TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    flex: 1,
  },
  modifyHint: {
    fontSize: 10,
    color: COLORS.primary,
    marginTop: 2,
  },
  ctxHint: {
    fontSize: 10,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  msgList: { flex: 1 },
  msgListContent: { padding: SPACING.md },
  emptyHint: {
    textAlign: 'center',
    color: COLORS.textTertiary,
    fontSize: TYPOGRAPHY.bodySmall,
    marginTop: 40,
  },
  msgRow: {
    marginBottom: SPACING.md,
    flexDirection: 'row',
  },
  msgRowUser: { justifyContent: 'flex-end' },
  msgRowAssistant: { justifyContent: 'flex-start' },
  msgBubble: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
  },
  msgBubbleUser: {
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4,
  },
  msgBubbleAssistant: {
    backgroundColor: COLORS.neutralLight || '#F5F5F5',
    borderBottomLeftRadius: 4,
  },
  msgText: {
    fontSize: TYPOGRAPHY.body,
    lineHeight: 22,
  },
  msgTextUser: { color: COLORS.textWhite },
  msgTextAssistant: { color: COLORS.textPrimary },
  systemRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  systemBubble: {
    backgroundColor: '#E8F5E9',
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    maxWidth: '85%',
    borderLeftWidth: 3,
    borderLeftColor: '#2D9F4E',
  },
  systemText: {
    fontSize: 12,
    color: '#2D9F4E',
    lineHeight: 18,
  },
  systemBubblePending: {
    borderLeftColor: '#FF9800',
    backgroundColor: '#FFF8E1',
  },
  generatingText: {
    fontSize: TYPOGRAPHY.caption,
    color: COLORS.primary,
    textAlign: 'center',
  },
  reasoningToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
    paddingLeft: 2,
  },
  reasoningToggleText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '500',
  },
  reasoningLiveHint: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginLeft: 4,
  },
  reasoningBox: {
    backgroundColor: '#F0F4FF',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginBottom: 4,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  reasoningText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  errorRow: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs,
  },
  errorText: {
    fontSize: TYPOGRAPHY.caption,
    color: '#E53935',
    textAlign: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: SPACING.sm,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    maxHeight: 100,
    backgroundColor: COLORS.background,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: COLORS.neutralLight || '#F5F5F5',
  },
});
