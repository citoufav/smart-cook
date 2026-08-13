import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Animated,
  useWindowDimensions,
  Switch,
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
import { callAIChatStream, RecipeContext, ToolCallResult, sendChatMessage } from '../services/chatService';
import { saveChat, loadChat, estimateTokens } from '../services/chatHistoryService';
import { cookingProgressService } from '../services/cookingProgressService';
import { applyRecipeChanges, RecipeChange } from '../services/recipeEditService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { SSEStreamController } from '../utils/sseStream';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoningContent?: string;
  /** 等待确认的工具调用 ID，渲染确认/取消按钮 */
  pendingConfirmId?: string;
}

interface ChatSheetProps {
  visible: boolean;
  onClose: () => void;
  recipeContext: RecipeContext;
}

export default function ChatSheet({ visible, onClose, recipeContext }: ChatSheetProps) {
  const { state: settingsState } = useSettings();
  const { state: cookingState, dispatch: cookingDispatch } = useCooking();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [allowModify, setAllowModify] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [expandedReasonings, setExpandedReasonings] = useState<Set<string>>(new Set());
  const flatListRef = useRef<FlatList>(null);
  const isNearBottomRef = useRef(true);
  const streamRef = useRef<SSEStreamController | null>(null);
  const pendingAssistantRef = useRef<string>('');
  const pendingReasoningRef = useRef<string>('');
  const prevTotalLinesRef = useRef(0); // 用于节流：仅在换行时触发滚动
  const toolCallingRef = useRef(false);
  const pendingToolCallsRef = useRef<ToolCallResult[] | null>(null);
  const pendingFullTextRef = useRef<string>('');
  const pendingConfirmIdRef = useRef<string>('');

  const slideAnim = useRef(new Animated.Value(screenHeight)).current;

  const sessionId = recipeContext.sessionId || 'default';

  // 键盘监听
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

  // 加载"允许修改菜谱"的全局记忆
  useEffect(() => {
    if (visible) {
      AsyncStorage.getItem(STORAGE_KEYS.CHAT_ALLOW_MODIFY).then((val) => {
        setAllowModify(val === 'true');
      }).catch(() => {});
    }
  }, [visible]);
  // 加载历史记录
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

  // 保存历史记录
  const persistMessages = useCallback((msgs: ChatMessage[]) => {
    if (sessionId === 'default') return;
    const plain = msgs.map((m) => ({ role: m.role, content: m.content, reasoningContent: m.reasoningContent }));
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

  const scrollToBottom = useCallback((force: boolean = false) => {
    if (!force && !isNearBottomRef.current) return;
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 50);
  }, []);

  const handleScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    isNearBottomRef.current = distanceFromBottom < 60;
  }, []);

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

  // 执行工具调用：将 modify_recipe 的修改应用到菜谱
  const executeToolCalls = useCallback((toolCalls: ToolCallResult[]): string => {
    const session = cookingState.session;
    if (!session) return '无活跃做菜会话';

    for (const tc of toolCalls) {
      if (tc.name !== 'modify_recipe') continue;
      try {
        const args = JSON.parse(tc.arguments);
        const reason: string = args.reason || '菜谱修改';
        const changes: RecipeChange[] = args.changes || [];
        if (changes.length === 0) continue;

        // 纯函数：把修改应用到菜单方案（不修改原对象，返回新方案）
        const { proposal, messages } = applyRecipeChanges(
          session.stages.menu?.menuProposal || ({} as any),
          changes,
        );

        // 使用 UPDATE_PLAN 一次性更新，不重置进度
        cookingDispatch({
          type: 'UPDATE_PLAN',
          payload: {
            menuProposal: proposal,
            prepSteps: proposal.prepSteps || [],
            cookingSteps: proposal.cookingSteps || [],
          },
        });

        // 持久化到 cookingProgressService
        const updatedSession = {
          ...session,
          stages: {
            ...session.stages,
            menu: session.stages.menu
              ? { ...session.stages.menu, menuProposal: proposal }
              : session.stages.menu,
            generatedPlan: session.stages.generatedPlan
              ? { ...session.stages.generatedPlan, prepSteps: proposal.prepSteps || [], cookingSteps: proposal.cookingSteps || [] }
              : session.stages.generatedPlan,
          },
        };
        cookingProgressService.save(updatedSession).catch(() => {});

        return `🔧 ${reason}\n${messages.join('\n')}`;
      } catch (e: any) {
        return `❌ 修改失败: ${e.message}`;
      }
    }
    return '未执行任何修改';
  }, [cookingState.session, cookingDispatch]);

  // 用户确认工具调用
  const handleConfirmToolCalls = useCallback(async () => {
    const toolCalls = pendingToolCallsRef.current;
    const fullText = pendingFullTextRef.current;
    const confirmId = pendingConfirmIdRef.current;
    if (!toolCalls) return;

    // 清除待确认状态
    pendingToolCallsRef.current = null;
    pendingConfirmIdRef.current = '';

    // 移除确认消息，替换为执行结果
    setMessages((prev) => prev.filter((m) => m.id !== `system-${confirmId}`));

    // 执行工具
    const resultText = executeToolCalls(toolCalls);
    setMessages((prev) => [...prev, {
      id: `system-${Date.now()}`,
      role: 'system',
      content: resultText,
    }]);
    scrollToBottom(true);

    // 构建跟进消息
    const followMessages: any[] = [];
    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        followMessages.push({ role: msg.role, content: msg.content });
      }
    }
    if (fullText) {
      followMessages.push({ role: 'assistant', content: fullText });
    }
    followMessages.push({
      role: 'assistant',
      content: fullText || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id, type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });
    for (const tc of toolCalls) {
      followMessages.push({ role: 'tool', tool_call_id: tc.id, content: resultText });
    }

    try {
      const followText = await sendChatMessage(followMessages, settingsState.preferences);
      setMessages((prev) => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: followText,
      }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, {
        id: `system-${Date.now()}`,
        role: 'system',
        content: `❌ 获取 AI 回复失败: ${e.message}`,
      }]);
    }
    scrollToBottom();
  }, [executeToolCalls, messages, settingsState.preferences, scrollToBottom]);

  // 用户取消工具调用
  const handleCancelToolCalls = useCallback(() => {
    const confirmId = pendingConfirmIdRef.current;
    pendingToolCallsRef.current = null;
    pendingConfirmIdRef.current = '';
    setMessages((prev) => prev.filter((m) => m.id !== `system-${confirmId}`));
    setMessages((prev) => [...prev, {
      id: `system-${Date.now()}`,
      role: 'system',
      content: '已取消修改',
    }]);
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

    const chatMessages = nextMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const assistantId = `assistant-${Date.now()}`;
    pendingAssistantRef.current = '';
    pendingReasoningRef.current = '';
    prevTotalLinesRef.current = 0;

    const stream = callAIChatStream(
      recipeContext,
      chatMessages,
      settingsState.preferences,
      {
        onReasoning: (token: string) => {
          pendingReasoningRef.current += token;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.id === assistantId) {
              return [...prev.slice(0, -1), {
                ...last,
                content: pendingAssistantRef.current,
                reasoningContent: pendingReasoningRef.current,
              }];
            }
            return [...prev, {
              id: assistantId,
              role: 'assistant',
              content: '',
              reasoningContent: pendingReasoningRef.current,
            }];
          });
          const totalLines = (pendingReasoningRef.current + pendingAssistantRef.current).split('\n').length;
          if (totalLines !== prevTotalLinesRef.current) {
            prevTotalLinesRef.current = totalLines;
            scrollToBottom();
          }
        },
        onToolCallDelta: (tcDeltas) => {
          // 首次收到工具调用时，在当前 assistant 消息上追加提示
          if (!toolCallingRef.current) {
            toolCallingRef.current = true;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.id === assistantId) {
                return [...prev.slice(0, -1), {
                  ...last,
                  content: pendingAssistantRef.current + '\n\n🔧 正在调用工具修改菜谱...',
                }];
              }
              return [...prev, {
                id: assistantId,
                role: 'assistant',
                content: '🔧 正在调用工具修改菜谱...',
              }];
            });
            scrollToBottom();
          }
        },
        onToken: (token: string) => {
          pendingAssistantRef.current += token;
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
        },
        onDone: (fullText: string, toolCalls?: ToolCallResult[]) => {
          setIsLoading(false);
          streamRef.current = null;

          if (toolCalls && toolCalls.length > 0) {
            toolCallingRef.current = false;
            pendingToolCallsRef.current = toolCalls;
            pendingFullTextRef.current = fullText;

            // 解析拟修改内容作为预览
            let previewLines: string[] = [];
            for (const tc of toolCalls) {
              if (tc.name !== 'modify_recipe') continue;
              try {
                const args = JSON.parse(tc.arguments);
                const changes: any[] = args.changes || [];
                for (const c of changes) {
                  switch (c.type) {
                    case 'adjust_ingredient':
                      previewLines.push(`  • ${c.dish || '?'}: ${c.ingredient} → ${c.new_weight}g`); break;
                    case 'replace_ingredient':
                      previewLines.push(`  • ${c.dish || '?'}: ${c.ingredient} → ${c.new_ingredient}`); break;
                    case 'add_ingredient':
                      previewLines.push(`  • ${c.dish || '?'}: +${c.ingredient}`); break;
                    case 'remove_ingredient':
                      previewLines.push(`  • ${c.dish || '?'}: -${c.ingredient}`); break;
                    case 'update_step':
                      previewLines.push(`  • 步骤${c.step_number}: 修改描述`); break;
                    case 'add_step':
                      previewLines.push(`  • 步骤${c.add_after_step}后: 新步骤`); break;
                    case 'remove_step':
                        previewLines.push(`  • 删除步骤${c.step_number}`); break;
                      case 'rename_dish':
                       previewLines.push(`  • ${c.dish || '?'} → 更名: ${c.new_dish}`); break;
                  }
                }
              } catch {}
            }

            const confirmId = `confirm-${Date.now()}`;
            pendingConfirmIdRef.current = confirmId;
            const previewText = `📋 拟修改:\n${previewLines.join('\n')}`;
            setMessages((prev) => [...prev, {
              id: `system-${confirmId}`,
              role: 'system',
              content: previewText,
              pendingConfirmId: confirmId,
            }]);
            scrollToBottom(true);
          } else {
            scrollToBottom();
            setMessages((prev) => {
              persistMessages(prev);
              return prev;
            });
          }
        },
        onError: (error: Error) => {
          setIsLoading(false);
          streamRef.current = null;
          setErrorMsg(error.message || '发送失败，请重试');
        },
      },
      allowModify,
    );

    streamRef.current = stream;
  }, [inputText, isLoading, messages, recipeContext, settingsState.preferences, scrollToBottom, allowModify, persistMessages]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    const isSystem = item.role === 'system';
    const hasReasoning = !isUser && !isSystem && item.reasoningContent && item.reasoningContent.length > 0;
    const hasContent = item.content.length > 0;
    const reasoningExpanded = expandedReasonings.has(item.id);

    // 系统消息（工具执行结果 / 确认提示）
    if (isSystem) {
      return (
        <View style={styles.systemRow}>
          <View style={[styles.systemBubble, item.pendingConfirmId && styles.systemBubblePending]}>
            <Text style={styles.systemText}>{item.content}</Text>
            {item.pendingConfirmId && item.pendingConfirmId === pendingConfirmIdRef.current && (
              <View style={styles.confirmRow}>
                <TouchableOpacity
                  style={styles.confirmCancelBtn}
                  onPress={handleCancelToolCalls}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confirmCancelText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmOkBtn}
                  onPress={handleConfirmToolCalls}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confirmOkText}>确认修改</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAssistant]}>
        <View style={{ maxWidth: '80%' }}>
          {/* 思考链 — 只有 AI 消息且有理内容时显示 */}
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
          {/* 正文气泡 — 有内容时才显示 */}
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
        {/* 头部 */}
        <View style={styles.header}>
          <View style={styles.headerHandle} />
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>菜谱助手</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.switchRow}>
            <Ionicons name="create-outline" size={16} color={allowModify ? COLORS.primary : COLORS.textTertiary} />
            <Text style={styles.switchLabel}>允许修改菜谱</Text>
            <Switch
              value={allowModify}
              onValueChange={(v) => {
                setAllowModify(v);
                AsyncStorage.setItem(STORAGE_KEYS.CHAT_ALLOW_MODIFY, String(v));
              }}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor={COLORS.textWhite}
            />
          </View>
          {allowModify && (
            <Text style={styles.modifyHint}>已开启菜谱编辑权限，AI 可建议修改配料和步骤</Text>
          )}
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
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  confirmCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  confirmCancelText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  confirmOkBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
  },
  confirmOkText: {
    fontSize: 12,
    color: COLORS.textWhite,
    fontWeight: '600',
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
