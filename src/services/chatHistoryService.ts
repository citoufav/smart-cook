import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { logger } from '../utils/logger';

const log = logger('SVC:CHAT_HIST');

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
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatSession[]) : [];
  } catch {
    // 数据损坏：先备份原始内容再返回空，避免修复写入后丢失排查线索
    try {
      const corrupted = await AsyncStorage.getItem(STORAGE_KEYS.CHAT_HISTORY);
      if (corrupted) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await AsyncStorage.setItem(`${STORAGE_KEYS.CHAT_HISTORY}_corrupted_${ts}`, corrupted);
      }
    } catch {}
    log.warn('聊天历史数据损坏，已备份原始内容并返回空');
    return [];
  }
}

async function saveAll(sessions: ChatSession[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(sessions));
  } catch (e) {
    log.error('saveAll 写入失败', String(e));
  }
}

/** Load chat history by session id */
export async function loadChat(sessionId: string): Promise<ChatSession | null> {
  const all = await getAll();
  return all.find((s) => s.id === sessionId) || null;
}

/** Save chat history (overwrite) */
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

/** Remove chat history */
export async function removeChat(sessionId: string): Promise<void> {
  const all = await getAll();
  await saveAll(all.filter((s) => s.id !== sessionId));
}

/** Estimate token count (rough estimate: a Chinese char ≈ 2 tokens, an English char ≈ 0.3 token, averaged to ≈ 1.5 per char) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length * 1.5);
}

/** Keep context within maxTokens by trimming oldest messages first */
export function trimContext<T extends { role: string; content: string }>(
  messages: T[],
  maxTokens: number = 200_000,
  systemMessages: number = 3, // first 3 are system + recipe context
): T[] {
  const systemMsgs = messages.slice(0, systemMessages);
  let conversationMsgs = messages.slice(systemMessages);

  let totalTokens = estimateTokens(
    systemMsgs.map((m) => m.content).join('') +
    conversationMsgs.map((m) => m.content).join(''),
  );

  // Trim from the oldest non-system messages
  while (totalTokens > maxTokens && conversationMsgs.length > 2) {
    conversationMsgs = conversationMsgs.slice(2); // remove one turn (user + assistant) at a time
    totalTokens = estimateTokens(
      systemMsgs.map((m) => m.content).join('') +
      conversationMsgs.map((m) => m.content).join(''),
    );
  }

  return [...systemMsgs, ...conversationMsgs];
}
