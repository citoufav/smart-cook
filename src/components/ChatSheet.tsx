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
import { useInventory } from '../contexts/InventoryContext';
import { useNutrition } from '../contexts/NutritionContext';
import { callAIChatStream, RecipeContext, ToolCallResult } from '../services/chatService';
import { saveChat, loadChat, estimateTokens } from '../services/chatHistoryService';
import { cookingProgressService } from '../services/cookingProgressService';
import { generateOneDishStream } from '../services/aiService';
import {
  applyEdits,
  diffEdits,
  isApplicableEdit,
  type EditDiffLine,
  type GeneratedDish,
  type MenuEdit,
  type ResolvedMenuEdit,
} from '../services/menuEditService';
import { RecipeChangeReview } from './RecipeChangeReview';
import { NutritionalData } from '../types';
import { logger } from '../utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { SSEStreamController } from '../utils/sseStream';

const logChat = logger('UI:CHAT');

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

/** 从 edit_menu 的工具调用里汇总出编辑动作（纯函数，不依赖组件状态） */
function collectEdits(toolCalls: ToolCallResult[]): MenuEdit[] {
  const out: MenuEdit[] = [];
  for (const tc of toolCalls) {
    if (tc.name !== 'edit_menu') continue;
    try {
      const args = JSON.parse(tc.arguments);
      if (Array.isArray(args?.edits)) out.push(...args.edits);
    } catch (e) {
      logChat.warn('edit_menu 参数解析失败', String(e));
    }
  }
  return out;
}

export default function ChatSheet({ visible, onClose, recipeContext }: ChatSheetProps) {
  const { state: settingsState } = useSettings();
  const { state: cookingState, dispatch: cookingDispatch, updateRequirement } = useCooking();
  const inventoryState = useInventory().state;
  const { setPreciseNutrition } = useNutrition();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [allowModify, setAllowModify] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [expandedReasonings, setExpandedReasonings] = useState<Set<string>>(new Set());
  /** 待确认的变更；非 null 时弹出独立预览面板 */
  const [review, setReview] = useState<{ edits: ResolvedMenuEdit[]; lines: EditDiffLine[] } | null>(null);
  const [generating, setGenerating] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const isNearBottomRef = useRef(true);
  const streamRef = useRef<SSEStreamController | null>(null);
  const pendingAssistantRef = useRef<string>('');
  const pendingReasoningRef = useRef<string>('');
  const prevTotalLinesRef = useRef(0); // Throttle: only trigger scroll when lines change
  const toolCallingRef = useRef(false);

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
  // 面板开着期间用户改过菜谱，拿旧快照会让模型基于过期菜谱推理（多轮修改会越改越偏）。
  const liveRecipeContext: RecipeContext = React.useMemo(() => {
    const mp = cookingState.session?.stages?.menu?.menuProposal;
    return {
      dishes: mp?.dishes || [],
      prepSteps: mp?.prepSteps || [],
      cookingSteps: mp?.cookingSteps || [],
      sessionId,
    };
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

  // Load the persisted "allow recipe modification" flag
  useEffect(() => {
    if (visible) {
      AsyncStorage.getItem(STORAGE_KEYS.CHAT_ALLOW_MODIFY).then((val) => {
        setAllowModify(val === 'true');
      }).catch(() => {});
    }
  }, [visible]);
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

  const appendSystem = useCallback((text: string, sendAsAssistant = false) => {
    const next: ChatMessage[] = [
      ...messagesRef.current,
      { id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'system', content: text, sendAsAssistant },
    ];
    setMessages(next);
    persistMessages(next);
    scrollToBottom(true);
  }, [persistMessages, scrollToBottom]);

  /**
   * 工具调用落地流程：
   *   结构化动作 → （需要新菜的先单独生成）→ 打开变更预览 → 用户勾选 → 纯本地应用
   * 不再"把一整份菜单重新生成一遍"。
   */
  const openReview = useCallback(async (rawEdits: MenuEdit[]) => {
    const session = cookingState.session;
    const menu = session?.stages.menu?.menuProposal;
    const requirement = session?.stages.requirement;
    if (!session || !menu || !requirement) {
      appendSystem('当前没有可修改的菜谱');
      return;
    }
    if (rawEdits.length === 0) {
      appendSystem('没听出要改哪一处，可以说得更具体点，例如"番茄炒蛋的盐改成3克"');
      return;
    }

    const resolved: ResolvedMenuEdit[] = [];
    const usable = rawEdits.filter((e) => isApplicableEdit(menu, e));
    const dropped = rawEdits.length - usable.length;
    if (usable.length === 0) {
      appendSystem('没找到要改的那道菜/食材，可以说得具体点，例如"番茄炒蛋里的盐改成3克"');
      return;
    }
    if (dropped > 0) {
      logChat.warn('部分编辑动作对不上当前菜谱，已跳过', { dropped, total: rawEdits.length });
    }

    for (const edit of usable) {
      if (edit.op !== 'add_dish' && edit.op !== 'replace_dish') {
        resolved.push(edit);
        continue;
      }
      setGenerating(true);
      try {
        const mode = edit.op === 'add_dish' ? 'add' : 'replace';
        const generated = await new Promise<GeneratedDish>((resolve, reject) => {
          generateOneDishStream(
            edit.instruction,
            mode,
            {
              dishNames: menu.dishes.map((d) => d.name),
              ingredients: inventoryState.ingredients.map((i) => ({
                name: i.name,
                weight: i.weight,
                createDate: i.createDate,
              })),
              seasonings: inventoryState.seasonings.map((s) => ({ name: s.name, status: s.status })),
              requirement,
              dietaryRestrictions: settingsState.preferences.dietaryRestrictions,
              tastePreferences: settingsState.preferences.tastePreferences,
              cookingSkill: settingsState.preferences.cookingSkill,
            },
            settingsState.preferences,
            { onDone: resolve, onError: reject },
          );
        });
        resolved.push({ ...edit, generated });
      } catch (e: any) {
        setGenerating(false);
        appendSystem(`生成新菜失败：${e.message || '未知错误'}`);
        return;
      }
    }
    setGenerating(false);
    setReview({ edits: resolved, lines: diffEdits(menu, resolved) });
  }, [cookingState.session, inventoryState, settingsState.preferences, appendSystem]);

  /** 用户在预览面板里确认后：纯本地应用，不发请求 */
  const applyReview = useCallback((selectedIndexes: number[]) => {
    const session = cookingState.session;
    const menu = session?.stages.menu?.menuProposal;
    const requirement = session?.stages.requirement;
    if (!session || !menu || !requirement || !review) return;

    const chosen = review.edits.filter((_, i) => selectedIndexes.includes(i));
    if (chosen.length === 0) {
      setReview(null);
      appendSystem('没有选中任何改动');
      return;
    }

    const nextMenu = applyEdits(menu, requirement, chosen, {
      inventoryNames: inventoryState.ingredients.map((i) => i.name),
    });

    // 人数变更要同时更新需求，但**不能**动当前进行到哪一步
    let nextRequirement = requirement;
    const personEdit = chosen.find((e) => e.op === 'set_person_count');
    if (personEdit && personEdit.op === 'set_person_count') {
      nextRequirement = { ...requirement, personCount: Math.max(1, Math.round(personEdit.personCount)) };
      updateRequirement(nextRequirement);
    }

    cookingDispatch({ type: 'UPDATE_PLAN', payload: { menuProposal: nextMenu } });

    if (nextMenu.dishes?.length && nextMenu.preciseNutrition?.length) {
      const nutritionByDish: Record<string, NutritionalData> = {};
      nextMenu.dishes.forEach((dish, i) => {
        const n = nextMenu.preciseNutrition?.[i];
        if (n) nutritionByDish[dish.name] = { ...n, source: 'precise' };
      });
      if (Object.keys(nutritionByDish).length > 0) {
        setPreciseNutrition(nutritionByDish, nextRequirement.personCount);
      }
    }

    const updatedSession = {
      ...session,
      stages: {
        ...session.stages,
        requirement: nextRequirement,
        menu: session.stages.menu ? { ...session.stages.menu, menuProposal: nextMenu } : session.stages.menu,
      },
    };
    cookingProgressService.save(updatedSession).catch(() => {});

    setReview(null);
    // sendAsAssistant：让下一轮对话能看到"刚刚改了什么"，否则模型还在用旧菜谱推理
    appendSystem(
      `✅ 已应用 ${chosen.length} 处修改\n${review.lines
        .filter((l) => selectedIndexes.includes(l.index))
        .map((l) => `· ${l.dish}：${l.text}`)
        .join('\n')}`,
      true,
    );
  }, [cookingState.session, review, inventoryState.ingredients, cookingDispatch, updateRequirement, setPreciseNutrition, appendSystem]);

  const cancelReview = useCallback(() => {
    setReview(null);
    appendSystem('已取消修改');
  }, [appendSystem]);

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
        onToolCallDelta: (tcDeltas) => {
          // On the first tool call delta, append a hint to the current assistant message
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
          flushAssistantToUi();
        },
        onDone: (fullText: string, toolCalls?: ToolCallResult[]) => {
          setIsLoading(false);
          streamRef.current = null;

          if (toolCalls && toolCalls.length > 0) {
            toolCallingRef.current = false;
            // 结构化动作 → 需要新菜的先单独生成 → 打开独立预览面板
            openReview(collectEdits(toolCalls));
            scrollToBottom(true);
          } else {
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
  }, [inputText, isLoading, messages, liveRecipeContext, settingsState.preferences, scrollToBottom, allowModify, persistMessages, openReview]);

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

        {generating && (
          <View style={styles.errorRow}>
            <Text style={styles.generatingText}>正在生成新菜…</Text>
          </View>
        )}

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
            editable={!isLoading && !generating}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || isLoading || generating) && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!inputText.trim() || isLoading || generating}
            activeOpacity={0.7}
          >
            <Ionicons
              name="send"
              size={20}
              color={inputText.trim() && !isLoading && !generating ? COLORS.textWhite : COLORS.textTertiary}
            />
          </TouchableOpacity>
        </View>
      </Animated.View>

      <RecipeChangeReview
        key={review ? review.edits.map((e) => e.op).join(',') + review.lines.length : 'none'}
        visible={!!review}
        lines={review?.lines ?? []}
        onCancel={cancelReview}
        onApply={applyReview}
      />
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
