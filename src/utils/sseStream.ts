/**
 * SSE streaming request utility
 * Uses XMLHttpRequest.onprogress for React Native-compatible SSE stream parsing
 */

import { logger } from './logger';

const log = logger('UTIL:SSE');

export interface SSECallbacks {
  /** Callback when a reasoning content chunk is received */
  onReasoning: (text: string) => void;
  /** Callback when a final content chunk is received */
  onContent: (text: string) => void;
  /** Callback when any raw data is received (for heartbeat/stall detection) */
  onData?: () => void;
  /** Callback when a tool_call delta is received (fires only when the model calls tools) */
  onToolCallDelta?: (toolCalls: Array<{ index: number; id?: string; name?: string; arguments: string }>) => void;
  /** Stream ended; returns the fully concatenated result and tool_calls */
  onDone: (fullContent: string, fullReasoning: string, toolCalls?: Array<{ id: string; name: string; arguments: string }>) => void;
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
 * @param timeoutMs Timeout in milliseconds, defaults to 5 minutes
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

  // Set request headers
  xhr.setRequestHeader('Content-Type', 'application/json');
  Object.entries(headers).forEach(([key, value]) => {
    xhr.setRequestHeader(key, value);
  });

  log.info('开始 SSE 流式请求');
  let sseChunkCount = 0;

  let fullContent = '';
  let fullReasoning = '';
  let lastProcessedIndex = 0;
  let buffer = '';

  // Accumulate tool calls (grouped by index)
  const toolCallMap = new Map<number, AccumulatedToolCall>();

  // Timeout handling
  const timeoutId = setTimeout(() => {
    abort();
    callbacks.onError(new Error('请求超时，请重试'));
  }, timeoutMs);

  const abort = () => {
    log.info('SSE 流被中止');
    clearTimeout(timeoutId);
    try { xhr.abort(); } catch {}
  };

  xhr.onprogress = () => {
    // Read the newly appended response text
    const newText = xhr.responseText.substring(lastProcessedIndex);
    lastProcessedIndex = xhr.responseText.length;
    if (!newText) return;

    // Any data arrival triggers a heartbeat (resets stall detection)
    callbacks.onData?.();

    buffer += newText;

    // Split SSE events by \n\n
    const events = buffer.split('\n\n');
    // The last one may be an incomplete event; keep it in the buffer
    buffer = events.pop() || '';

    for (const event of events) {
      const trimmed = event.trim();
      if (!trimmed || trimmed === 'data: [DONE]') {
        // Stream end marker
        continue;
      }

      // Parse data: {...} lines
      const lines = trimmed.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.substring(6).trim();
        if (jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

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
          if (delta.tool_calls && callbacks.onToolCallDelta) {
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
            const current: Array<{ index: number; id?: string; name?: string; arguments: string }> = [];
            toolCallMap.forEach((v, k) => current.push({ index: k, id: v.id, name: v.name, arguments: v.arguments }));
            callbacks.onToolCallDelta(current);
          }
        } catch {
          log.warn('JSON 解析失败，跳过此 SSE chunk');
        }
      }
    }
  };

  xhr.onloadend = () => {
    clearTimeout(timeoutId);

    if (xhr.status >= 200 && xhr.status < 300) {
      log.info(`SSE 流结束`, { totalChunks: sseChunkCount });
      // Process the last event possibly remaining in the buffer
      if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
        const lines = buffer.trim().split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.substring(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
            }
            if (delta?.reasoning_content) {
              fullReasoning += delta.reasoning_content;
            }
            if (delta?.tool_calls) {
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
            }
          } catch {}
        }
      }
      const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
      toolCallMap.forEach((v) => toolCalls.push({ id: v.id, name: v.name, arguments: v.arguments }));
      callbacks.onDone(fullContent, fullReasoning, toolCalls.length > 0 ? toolCalls : undefined);
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
    clearTimeout(timeoutId);
    log.error('SSE 网络连接失败');
    callbacks.onError(new Error('网络连接失败，请检查网络后重试'));
  };

  xhr.send(JSON.stringify(body));

  return { abort };
}
