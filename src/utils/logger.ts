/**
 * 全局日志工具
 *
 * 使用方式：
 *   import { logger } from '../../src/utils/logger';
 *   const log = logger('MODULE_NAME');
 *   log.info('消息', { data });
 *   log.warn('警告');
 *   log.error('错误', error);
 *
 * 日志格式：[HH:MM:SS.mmm] [LEVEL] [MODULE] 消息
 */

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: -1,
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 可在此调整全局最低日志级别
const MIN_LEVEL: LogLevel = __DEV__ ? 'debug' : 'info';

function timestamp(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function formatMessage(level: LogLevel, module: string, message: string, extra?: any): string {
  const ts = timestamp();
  const tag = `[${ts}] [${level.toUpperCase().padEnd(5)}] [${module}]`;
  if (extra !== undefined) {
    const extraStr = typeof extra === 'string' ? extra : JSON.stringify(extra);
    if (extraStr.length > 500) {
      return `${tag} ${message} ${extraStr.slice(0, 500)}...[truncated]`;
    }
    return `${tag} ${message} ${extraStr}`;
  }
  return `${tag} ${message}`;
}

export interface Logger {
  trace: (message: string, extra?: any) => void;
  debug: (message: string, extra?: any) => void;
  info: (message: string, extra?: any) => void;
  warn: (message: string, extra?: any) => void;
  error: (message: string, extra?: any) => void;
  /** 带耗时统计：log.time(label) 开始，log.timeEnd(label) 结束 */
  time: (label: string) => void;
  timeEnd: (label: string) => void;
}

interface TimeEntry {
  module: string;
  start: number;
}

const timers = new Map<string, TimeEntry>();

export function logger(module: string): Logger {
  function shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
  }

  return {
    trace(message, extra?) {
      if (!shouldLog('trace')) return;
      console.debug(formatMessage('trace', module, message, extra));
    },

    debug(message, extra?) {
      if (!shouldLog('debug')) return;
      console.debug(formatMessage('debug', module, message, extra));
    },

    info(message, extra?) {
      if (!shouldLog('info')) return;
      console.log(formatMessage('info', module, message, extra));
    },

    warn(message, extra?) {
      if (!shouldLog('warn')) return;
      console.warn(formatMessage('warn', module, message, extra));
    },

    error(message, extra?) {
      if (!shouldLog('error')) return;
      console.error(formatMessage('error', module, message, extra));
    },

    time(label: string) {
      const key = `${module}:${label}`;
      timers.set(key, { module, start: Date.now() });
      console.log(formatMessage('debug', module, `⏱ ${label} 开始`));
    },

    timeEnd(label: string) {
      const key = `${module}:${label}`;
      const entry = timers.get(key);
      if (entry) {
        const elapsed = Date.now() - entry.start;
        timers.delete(key);
        console.log(formatMessage('debug', module, `⏱ ${label} 完成 | 耗时: ${elapsed}ms`));
      }
    },
  };
}

export default logger;
