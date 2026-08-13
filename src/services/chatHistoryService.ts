import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/storageKeys';

const MAX_SESSIONS = 30;

export interface ChatSession {
  id: string;          // recipe session id
  messages: { role: 'user' | 'assistant'; content: string }[];
  updatedAt: string;
}

async function getAll(): Promise<ChatSession[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.CHAT_HISTORY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

async function saveAll(sessions: ChatSession[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(sessions));
}

/** 根据 session id 加载聊天记录 */
export async function loadChat(sessionId: string): Promise<ChatSession | null> {
  const all = await getAll();
  return all.find((s) => s.id === sessionId) || null;
}

/** 保存聊天记录（覆盖） */
export async function saveChat(sessionId: string, messages: { role: 'user' | 'assistant'; content: string }[]): Promise<void> {
  const all = await getAll();
  const idx = all.findIndex((s) => s.id === sessionId);

  const session: ChatSession = {
    id: sessionId,
    messages,
    updatedAt: new Date().toISOString(),
  };

  if (idx >= 0) {
    all[idx] = session;
  } else {
    all.unshift(session);
    if (all.length > MAX_SESSIONS) all.length = MAX_SESSIONS;
  }
  await saveAll(all);
}

/** 删除聊天记录 */
export async function removeChat(sessionId: string): Promise<void> {
  const all = await getAll();
  await saveAll(all.filter((s) => s.id !== sessionId));
}

/** 估算 token 数（简单估算：中文 1 字 ≈ 2 token，英文 1 字 ≈ 0.3 token，取平均 1 字 ≈ 1.5 token） */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length * 1.5);
}

/** 控制上下文在 maxTokens 以内，从旧消息开始裁剪 */
export function trimContext(
  messages: { role: string; content: string }[],
  maxTokens: number = 200_000,
  systemMessages: number = 3, // 前 3 条是 system + recipe context
): { role: string; content: string }[] {
  const systemMsgs = messages.slice(0, systemMessages);
  let conversationMsgs = messages.slice(systemMessages);

  let totalTokens = estimateTokens(
    systemMsgs.map((m) => m.content).join('') +
    conversationMsgs.map((m) => m.content).join(''),
  );

  // 从最早的非系统消息开始裁剪
  while (totalTokens > maxTokens && conversationMsgs.length > 2) {
    conversationMsgs = conversationMsgs.slice(2); // 一次移除一轮（user + assistant）
    totalTokens = estimateTokens(
      systemMsgs.map((m) => m.content).join('') +
      conversationMsgs.map((m) => m.content).join(''),
    );
  }

  return [...systemMsgs, ...conversationMsgs];
}
