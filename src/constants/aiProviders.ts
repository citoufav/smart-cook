/**
 * AI 服务商预设。
 *
 * 只留**两种协议**、三家预设。理由：自己维护一堆厂商的地址和模型名是纯负担，
 * 而几乎所有主流厂商都提供这两种兼容端点之一（Kimi、智谱、通义、SiliconFlow、
 * OpenRouter、本地 Ollama/vLLM 基本都支持 OpenAI 兼容；DeepSeek 自己也提供
 * Anthropic 兼容端点）。要接谁，选对应协议、把地址和模型名填进去就行。
 *
 * `protocol` 决定请求形状和流式解析方式（见 services/aiClient.ts、utils/sseStream.ts），
 * 不是装饰字段 —— 选错协议会直接调不通。
 */
import type { AIProtocol } from '../utils/aiRequest';

export type { AIProtocol };

export interface AIProviderPreset {
  id: string;
  label: string;
  protocol: AIProtocol;
  baseUrl: string;
  /** 空字符串 = 让用户自己填模型名 */
  model: string;
  /** 显示在下拉下方的说明 */
  hint?: string;
}

export const AI_PROVIDERS: AIProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek（官方）',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    // 刻意不给 hint：DeepSeek 用户只需要贴一个 Key，怎么拿由首启引导页负责解释，
    // 设置里再写一遍就是重复噪音
  },
  {
    id: 'openai',
    label: 'OpenAI 兼容',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '走 /chat/completions。用别家时改地址和模型名即可（Kimi、智谱、通义、Ollama…）',
  },
  {
    id: 'anthropic',
    label: 'Anthropic 兼容',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    hint: '走 /v1/messages。DeepSeek 也提供 Anthropic 兼容端点（https://api.deepseek.com/anthropic）',
  },
];

export function findProvider(id: string): AIProviderPreset | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

/** 只有 DeepSeek 认 `thinking` / `reasoning_effort` 这两个字段 */
export function isDeepSeekType(id: string): boolean {
  return id === 'deepseek';
}
