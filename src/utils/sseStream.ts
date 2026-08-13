/**
 * SSE 流式请求工具
 * 使用 XMLHttpRequest.onprogress 实现 React Native 兼容的 SSE 流解析
 */

import { logger } from './logger';

const log = logger('UTIL:SSE');

export interface SSECallbacks {
  /** 收到推理内容片段时回调 */
  onReasoning: (text: string) => void;
  /** 收到最终内容片段时回调 */
  onContent: (text: string) => void;
  /** 收到任意原始数据时回调（用于心跳/卡顿检测） */
  onData?: () => void;
  /** 收到 tool_call delta 时回调（仅当模型调用工具时触发） */
  onToolCallDelta?: (toolCalls: Array<{ index: number; id?: string; name?: string; arguments: string }>) => void;
  /** 流结束，返回完整拼接结果和 tool_calls */
  onDone: (fullContent: string, fullReasoning: string, toolCalls?: Array<{ id: string; name: string; arguments: string }>) => void;
  /** 出错时回调 */
  onError: (error: Error) => void;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface SSEStreamController {
  /** 取消请求 */
  abort: () => void;
}

/**
 * 发起 SSE 流式请求
 * @param url API 端点
 * @param body 请求体
 * @param headers 请求头
 * @param callbacks 回调
 * @param timeoutMs 超时时间（毫秒），默认 5 分钟
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

  // 设置请求头
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

  // 工具调用累积（按 index 分组）
  const toolCallMap = new Map<number, AccumulatedToolCall>();

  // 超时处理
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
    // 读取新增的响应文本
    const newText = xhr.responseText.substring(lastProcessedIndex);
    lastProcessedIndex = xhr.responseText.length;
    if (!newText) return;

    // 任意数据到达即触发心跳（用于重置卡顿检测）
    callbacks.onData?.();

    buffer += newText;

    // 按 \n\n 分割 SSE 事件
    const events = buffer.split('\n\n');
    // 最后一个可能是不完整的事件，保留在 buffer 中
    buffer = events.pop() || '';

    for (const event of events) {
      const trimmed = event.trim();
      if (!trimmed || trimmed === 'data: [DONE]') {
        // 流结束标记
        continue;
      }

      // 解析 data: {...} 行
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
          // 处理 tool_calls delta（流式工具调用）
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
      // 处理 buffer 中可能残留的最后事件
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
      // 错误处理
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
      // status === 0 表示被 abort 或网络错误，由 abort 方处理
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
