import { UserPreferences } from '../types';
import { findProvider, isDeepSeekType } from '../constants/aiProviders';
import { buildChatBody, type AIProtocol, type AIChatMessage } from '../utils/aiRequest';

export type { AIChatMessage, AIProtocol };
export { buildChatBody };

/**
 * AI 调用的统一出口：协议、地址、认证头、请求体。
 *
 * 支持两种协议：
 * - `openai`   —— POST /chat/completions，Bearer 认证，choices[0].delta 流
 * - `anthropic` —— POST /v1/messages，x-api-key 认证，content_block_delta 流
 *
 * 调用方不该自己拼 body：协议差异全部收口在这里 + utils/aiRequest.ts，
 * 加一家厂商只是往 constants/aiProviders.ts 里加一行预设。
 *
 * 将来接云端代理（用户不带 key、由服务端计费）时，**只改这个文件**：
 * 把 aiHeaders 换成会话 token，aiEndpoint 换成自建网关地址，调用方一行都不用动。
 */
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-flash';
const ANTHROPIC_VERSION = '2023-06-01';

export function aiProtocol(prefs: UserPreferences): AIProtocol {
  return findProvider(prefs.apiType)?.protocol ?? 'openai';
}

/** 完整请求地址，容忍用户填的地址末尾带斜杠 */
export function aiEndpoint(prefs: UserPreferences): string {
  // DeepSeek 官方**不给改地址**：界面里根本没有那个输入框。
  // 顺便避免老用户 prefs 里残留一个奇怪的地址，却没有任何地方能改回来。
  // 想指向代理，去选「OpenAI 兼容」。
  const base = isDeepSeekType(prefs.apiType)
    ? DEFAULT_BASE_URL
    : (prefs.apiUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return `${base}${aiProtocol(prefs) === 'anthropic' ? '/v1/messages' : '/chat/completions'}`;
}

export function aiModel(prefs: UserPreferences): string {
  // 同理：DeepSeek 固定 flash，不读 prefs.modelName（老用户可能存着 v4-pro 却改不回来）
  if (isDeepSeekType(prefs.apiType)) return DEFAULT_MODEL;
  return prefs.modelName || findProvider(prefs.apiType)?.model || DEFAULT_MODEL;
}

/** 认证头。两种协议的头完全不一样，这是最容易搞错的地方 */
export function aiHeaders(prefs: UserPreferences): Record<string, string> {
  if (aiProtocol(prefs) === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': prefs.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${prefs.apiKey}`,
  };
}

export interface AIChatInput {
  messages: AIChatMessage[];
  maxTokens: number;
  /**
   * 要不要开思考模式：
   * - `auto` = 开（菜单生成用，强度固定 high）
   * - `off`  = 明确关掉（跑单道菜、聊天这种不需要长思考的场景）
   */
  thinking?: 'auto' | 'off';
  /** 要求返回 JSON。只有 OpenAI 兼容协议有这个参数，Anthropic 靠提示词里写死 */
  json?: boolean;
}

/** 这家会不会真的返回思考过程。UI 用它决定要不要展示思考窗口，别展示一个永远空着的框 */
export function aiSupportsThinking(prefs: UserPreferences): boolean {
  return aiProtocol(prefs) === 'anthropic' || isDeepSeekType(prefs.apiType);
}

export function aiBody(prefs: UserPreferences, input: AIChatInput): Record<string, unknown> {
  const protocol = aiProtocol(prefs);
  /**
   * 思考模式**不再由用户选**：界面上的开关和强度都撤掉了。
   * 菜单生成固定开、固定高强度；聊天和单道菜走 thinking:'off' 不受影响。
   *
   * 为什么不读 `prefs.thinkingEnabled`：老用户的这个值是 false，而界面已经没有
   * 地方能把它打开 —— 读它等于让一部分人永远拿不到"默认就该有"的效果。
   */
  const wantThinking = input.thinking === 'auto';

  return buildChatBody({
    protocol,
    model: aiModel(prefs),
    messages: input.messages,
    maxTokens: input.maxTokens,
    thinking: aiSupportsThinking(prefs) ? { enabled: wantThinking, effort: 'high' } : undefined,
    json: input.json,
  });
}
