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
  const base = (prefs.apiUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return `${base}${aiProtocol(prefs) === 'anthropic' ? '/v1/messages' : '/chat/completions'}`;
}

export function aiModel(prefs: UserPreferences): string {
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
   * - `auto` = 听用户设置
   * - `off`  = 明确关掉（跑单道菜、聊天这种不需要长思考的场景）
   */
  thinking?: 'auto' | 'off';
  /** 要求返回 JSON。只有 OpenAI 兼容协议有这个参数，Anthropic 靠提示词里写死 */
  json?: boolean;
}

export function aiBody(prefs: UserPreferences, input: AIChatInput): Record<string, unknown> {
  const protocol = aiProtocol(prefs);
  const wantThinking = input.thinking === 'auto' && prefs.thinkingEnabled;
  // 只有 Anthropic 和 DeepSeek 认思考相关字段，别家一律不发
  const supportsThinking = protocol === 'anthropic' || isDeepSeekType(prefs.apiType);

  return buildChatBody({
    protocol,
    model: aiModel(prefs),
    messages: input.messages,
    maxTokens: input.maxTokens,
    thinking: supportsThinking ? { enabled: wantThinking, effort: prefs.reasoningEffort } : undefined,
    json: input.json,
  });
}
