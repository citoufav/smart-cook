import { UserPreferences } from '../types';

/**
 * AI 调用的统一出口：地址 / 模型 / 认证头。
 *
 * 现在只有一种模式——BYOK 直连（用户自己填 key，直连 OpenAI 兼容端点）。
 * 将来接云端代理（用户不带 key、由服务端计费）时，**只改这个文件**：
 * 把 aiHeaders 换成会话 token，aiEndpoint 换成自建网关地址，调用方一行都不用动。
 */
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-pro';

/** /chat/completions 的完整地址，容忍用户填的地址末尾带斜杠 */
export function aiEndpoint(prefs: UserPreferences): string {
  return `${(prefs.apiUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}/chat/completions`;
}

export function aiModel(prefs: UserPreferences): string {
  return prefs.modelName || DEFAULT_MODEL;
}

/** 认证头。云端代理落地时这里是唯一要改的地方 */
export function aiHeaders(prefs: UserPreferences): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${prefs.apiKey}`,
  };
}
