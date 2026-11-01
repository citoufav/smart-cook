/**
 * AI 服务商预设。
 *
 * 只有**OpenAI 兼容协议**（`POST /chat/completions`）的服务商能进这张表 ——
 * 因为客户端只有一条请求/解析路径（见 services/aiClient.ts 与 sseStream.ts）。
 *
 * Anthropic 不在表里，是刻意的：它走 `POST /v1/messages`，认证用 `x-api-key` +
 * `anthropic-version`，流式事件结构也完全不同（content_block_delta 那套）。
 * 塞进下拉里只会得到一个"选了就用不了"的选项，真支持得写第二个适配器。
 *
 * 选定服务商只是**填一次**地址和模型名，之后字段仍可手改 —— 预设是省事，不是锁死。
 */
export interface AIProviderPreset {
  id: string;
  label: string;
  /** 空字符串 = 自定义，沿用用户当前填的 */
  baseUrl: string;
  /** 空字符串 = 让用户自己填模型名 */
  model: string;
}

export const AI_PROVIDERS: AIProviderPreset[] = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'moonshot', label: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
];

export function findProvider(id: string): AIProviderPreset | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

/** 只有 DeepSeek 认 `thinking` / `reasoning_effort` 这两个字段，别家发过去可能直接 400 */
export function isDeepSeekType(id: string): boolean {
  return id === 'deepseek';
}
