/**
 * SSE streaming request utility
 * Uses XMLHttpRequest.onprogress for React Native-compatible SSE stream parsing
 */

import { logger } from './logger';

const log = logger('UTIL:SSE');

/** 闲置超时：超过该时间未收到任何数据视为连接停滞（区别于总超时） */
const IDLE_TIMEOUT_MS = 120_000;

export interface SSECallbacks {
  /** Callback when a reasoning content chunk is received */
  onReasoning: (text: string) => void;
  /** Callback when a final content chunk is received */
  onContent: (text: string) => void;
  /** Callback when any raw data is received (for heartbeat/stall detection) */
  onData?: () => void;
  /** Callback when a tool_call delta is received (fires only when the model calls tools) */
  onToolCallDelta?: (toolCalls: { index: number; id?: string; name?: string; arguments: string }[]) => void;
  /** Stream ended; returns the fully concatenated result and tool_calls */
  onDone: (
    fullContent: string,
    fullReasoning: string,
    toolCalls?: { id: string; name: string; arguments: string }[],
    /** stop / length / content_filter / tool_calls …；length 表示输出被截断 */
    finishReason?: string,
  ) => void;
  /** Callback on error */
  onError: (error: Error) => void;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface SSEStreamController {
  /** Cancel the request */
  abort: () => void;
}

/**
 * Start an SSE streaming request
 * @param url API endpoint
 * @param body Request body
 * @param headers Request headers
 * @param callbacks Callbacks
 * @param timeoutMs Total timeout in milliseconds, defaults to 5 minutes
 */
export function sseStreamFetch(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  callbacks: SSECallbacks,
  timeoutMs: number = 300_000,
): SSEStreamController {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);

  // Set request headers（调用方已带 Content-Type 时不重复设置，避免 XHR 合并出重复头）
  const hasContentTypeHeader = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
  if (!hasContentTypeHeader) {
    xhr.setRequestHeader('Content-Type', 'application/json');
  }
  Object.entries(headers).forEach(([key, value]) => {
    xhr.setRequestHeader(key, value);
  });

  log.info('开始 SSE 流式请求', { timeoutMs });
  let sseChunkCount = 0;

  let fullContent = '';
  let fullReasoning = '';
  let lastProcessedIndex = 0;
  let buffer = '';
  let settled = false; // onDone / onError 只触发一次
  let finishReason: string | undefined;

  // Accumulate tool calls (grouped by index)
  const toolCallMap = new Map<number, AccumulatedToolCall>();

  // ---- 定时器：总超时 + 闲置超时 ----
  let totalTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    if (totalTimeoutId) clearTimeout(totalTimeoutId);
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
  };

  const finishWithError = (error: Error) => {
    if (settled) return;
    settled = true;
    clearTimers();
    try { xhr.abort(); } catch {}
    callbacks.onError(error);
  };

  const resetIdleTimer = () => {
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(() => {
      if (settled) return;
      log.warn(`SSE 闲置超时（${IDLE_TIMEOUT_MS}ms 无数据），中止连接`);
      finishWithError(new Error(`连接停滞（${Math.round(IDLE_TIMEOUT_MS / 1000)} 秒未收到数据），请检查网络后重试`));
    }, IDLE_TIMEOUT_MS);
  };

  const abort = () => {
    log.info('SSE 流被中止');
    settled = true;
    clearTimers();
    try { xhr.abort(); } catch {}
  };

  totalTimeoutId = setTimeout(() => {
    finishWithError(new Error('请求超时，请重试'));
  }, timeoutMs);

  resetIdleTimer();

  /** Parse a single SSE data line and merge deltas into the accumulators */
  const handleDataLine = (jsonStr: string): void => {
    if (jsonStr === '[DONE]') return;
    try {
      const parsed = JSON.parse(jsonStr);
      const choice = parsed.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta;
      if (!delta) return;

      if (delta.reasoning_content) {
        fullReasoning += delta.reasoning_content;
        callbacks.onReasoning(delta.reasoning_content);
        sseChunkCount++;
        log.trace('SSE 事件', { type: 'reasoning' });
      }
      if (delta.content) {
        fullContent += delta.content;
        callbacks.onContent(delta.content);
        sseChunkCount++;
        log.trace('SSE 事件', { type: 'content' });
      }
      // Handle tool_calls delta (streaming tool calls)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx: number = tc.index ?? 0;
          let acc = toolCallMap.get(idx);
          if (!acc) {
            acc = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
            toolCallMap.set(idx, acc);
          }
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
        if (callbacks.onToolCallDelta) {
          const current: { index: number; id?: string; name?: string; arguments: string }[] = [];
          toolCallMap.forEach((v, k) => current.push({ index: k, id: v.id, name: v.name, arguments: v.arguments }));
          callbacks.onToolCallDelta(current);
        }
      }
    } catch {
      log.warn('JSON 解析失败，跳过此 SSE chunk');
    }
  };

  /**
   * 解析缓冲区中的 SSE 事件（以空行分隔）。
   * @param flush true = 流已结束，处理缓冲区全部剩余内容
   */
  const processBuffer = (flush: boolean): void => {
    const events = buffer.split('\n\n');
    buffer = flush ? '' : events.pop() || '';
    for (const event of events) {
      const trimmed = event.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      const lines = trimmed.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        handleDataLine(line.substring(6).trim());
      }
    }
  };

  xhr.onprogress = () => {
    // Read the newly appended response text
    const newText = xhr.responseText.substring(lastProcessedIndex);
    lastProcessedIndex = xhr.responseText.length;
    if (!newText) return;

    // Any data arrival resets stall detection
    resetIdleTimer();
    callbacks.onData?.();

    buffer += newText;
    processBuffer(false);
  };

  xhr.onloadend = () => {
    if (settled) return;
    settled = true;
    clearTimers();

    if (xhr.status >= 200 && xhr.status < 300) {
      log.info(`SSE 流结束`, { totalChunks: sseChunkCount, finishReason });
      // Process the last event possibly remaining in the buffer
      processBuffer(true);
      const toolCalls: { id: string; name: string; arguments: string }[] = [];
      toolCallMap.forEach((v) => toolCalls.push({ id: v.id, name: v.name, arguments: v.arguments }));
      callbacks.onDone(fullContent, fullReasoning, toolCalls.length > 0 ? toolCalls : undefined, finishReason);
    } else {
      // Error handling
      if (xhr.status === 401) {
        callbacks.onError(new Error('API Key 无效，请在设置中更新'));
      } else if (xhr.status === 403) {
        callbacks.onError(new Error('访问被拒绝（403），请检查 API Key 权限'));
      } else if (xhr.status === 404) {
        callbacks.onError(new Error('API 端点不存在（404），请检查 API 地址配置'));
      } else if (xhr.status === 400) {
        callbacks.onError(new Error('请求参数错误（400）'));
      } else if (xhr.status >= 500) {
        callbacks.onError(new Error(`服务器错误（${xhr.status}），请稍后重试`));
      } else if (xhr.status !== 0) {
        callbacks.onError(new Error(`请求失败（${xhr.status}）`));
      }
      // status === 0 means aborted or network error; handled by the aborting side
    }
  };

  xhr.onerror = () => {
    log.error('SSE 网络连接失败');
    finishWithError(new Error('网络连接失败，请检查网络后重试'));
  };

  xhr.send(JSON.stringify(body));

  return { abort };
}
