/**
 * 请求体的协议差异，全在这一处。
 *
 * 抽成纯函数是为了能跑自检（`npm run check:ai`）—— 两种协议的 body 形状不一样，
 * 而这块**没法对着真实 API 验证**（没有 key、也不该把 key 放进仓库），
 * 所以至少要能断言"该有的字段有、不该有的没跑出来"。
 *
 * 归纳成两句话：
 * - OpenAI 兼容：system 留在 messages 里；可选 `response_format`；DeepSeek 另有 `thinking`
 * - Anthropic：system 提到顶层；**没有** `response_format`；思考是 `thinking.budget_tokens`
 */

export type AIProtocol = 'openai' | 'anthropic';

/**
 * 消息内容块。图片只支持 `data:image/...;base64,` 形式 ——
 * 拍完照直接内联发，不用 Files API（那要多一次上传，还得管文件生命周期）。
 * DeepSeek 的 `deepseek-flash` 和两家协议都认这种内联图，见
 * https://api-docs.deepseek.com/zh-cn/guides/vision
 */
export type AIContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; dataUrl: string };

export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AIContentBlock[];
}

const DATA_URL = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

/** 纯文本消息原样返回；块数组拼出它的文字部分（system 合并要用） */
function textOf(content: AIChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n');
}

/**
 * 块数组 → 对应协议的内容块。**认不出 data URL 的图片块直接丢掉**：
 * 少一张图顶多识别得差一点，拼一个畸形请求进去是 400。
 */
function mapContent(content: AIChatMessage['content'], protocol: AIProtocol): unknown {
  if (typeof content === 'string') return content;
  const out: unknown[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      out.push({ type: 'text', text: block.text });
      continue;
    }
    const m = DATA_URL.exec(block.dataUrl);
    if (!m) continue;
    out.push(
      protocol === 'anthropic'
        // Anthropic 用 image 块，base64 要拆成 media_type + data
        ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
        // OpenAI 兼容（含 DeepSeek）：image_url 装整个 data URL。
        // detail 给 auto：图片本来就会缩到约 1300×1300、单图最多算 1024 token，
        // 省不了多少，但识别准确率是实打实的
        : { type: 'image_url', image_url: { url: block.dataUrl, detail: 'auto' } },
    );
  }
  return out;
}

export interface ChatBodyInput {
  protocol: AIProtocol;
  model: string;
  messages: AIChatMessage[];
  maxTokens: number;
  /**
   * 只有两种情况传：
   * - Anthropic（它真的有 thinking 字段）
   * - DeepSeek（它真的认 thinking/reasoning_effort）
   * 别的 OpenAI 兼容厂商收到未知参数可能直接 400，所以宁可省略。
   */
  thinking?: { enabled: boolean; effort?: string };
  /** 要不要 json_object。Anthropic 没这个参数，硬塞会 400 */
  json?: boolean;
}

/** Anthropic 的思考预算，按档位给。必须小于 max_tokens，否则 400 */
const THINKING_BUDGET: Record<string, number> = { low: 2048, high: 4096, max: 8192 };

export function buildChatBody(input: ChatBodyInput): Record<string, unknown> {
  const { protocol, model, messages, maxTokens } = input;
  const wantThinking = input.thinking?.enabled === true;

  if (protocol === 'anthropic') {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => textOf(m.content))
      .join('\n\n');
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      // Anthropic 的 messages 里只能有 user/assistant
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: mapContent(m.content, 'anthropic') })),
      stream: true,
    };
    if (system) body.system = system;
    if (wantThinking) {
      const budget = Math.min(
        THINKING_BUDGET[input.thinking?.effort ?? 'high'] ?? 4096,
        // 预算必须比 max_tokens 小，留出至少 1K 给正文
        Math.max(1024, maxTokens - 1024),
      );
      body.thinking = { type: 'enabled', budget_tokens: budget };
    }
    return body;
  }

  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: mapContent(m.content, 'openai') })),
    stream: true,
    max_tokens: maxTokens,
  };
  if (input.thinking) {
    body.thinking = wantThinking ? { type: 'enabled' } : { type: 'disabled' };
    if (wantThinking && input.thinking.effort) body.reasoning_effort = input.thinking.effort;
  }
  if (input.json) body.response_format = { type: 'json_object' };
  return body;
}
