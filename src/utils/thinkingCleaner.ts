/**
 * Chain-of-thought text cleaning utility
 * Filters out code, JSON, English fragments, tool-call formats, etc., preserving natural-language content
 */

import { logger } from './logger';

const log = logger('UTIL:THINK');

let lastReportTime = 0;
const REPORT_INTERVAL_MS = 5000; // report once every 5 seconds

/**
 * Clean chain-of-thought text: remove code/JSON/pure-English lines
 */
export function cleanThinkingText(rawText: string): string {
  const lines = rawText.split('\n');
  const cleaned: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // Keep blank lines as paragraph separators (but collapse consecutive ones)
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== '') {
        cleaned.push('');
      }
      continue;
    }

    // Lines to skip:
    // 1. Markdown code block markers
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) continue;

    // 2. Pure JSON structures (start with { [ and contain no Chinese)
    if (/^[\{\[].*[\}\]]$/.test(trimmed) && !containsChinese(trimmed)) continue;

    // 3. SSE format starting with data:
    if (trimmed.startsWith('data:')) continue;

    // 4. Pure English lines (no Chinese chars and longer than 3 chars)
    if (!containsChinese(trimmed) && trimmed.length > 3 && /^[a-zA-Z0-9\s\.\,\;\:\!\?\(\)\[\]\{\}\"\'\_\-\+\=\/\*\#\@\$\%\^\&\|\\\<\>\~]+$/.test(trimmed)) {
      // but still keep short English phrases (e.g. "OK")
      continue;
    }

    // 5. Function call formats (e.g. get_date(), call_xxx)
    if (/^[a-z_]+\s*\(.*\)\s*$/i.test(trimmed) && !containsChinese(trimmed)) continue;

    // 6. Tool-call related lines
    if (/^(Turn|Tool|function|reasoning_content|tool_calls|arguments)[\s\=:]/.test(trimmed)) continue;

    // Clean up in-line noise
    let cleanLine = trimmed;

    // Remove in-line JSON fragments (e.g. {"key": "value"})
    cleanLine = cleanLine.replace(/\{[^{}]*"([^"]*)"\s*:\s*"[^"]*"[^{}]*\}/g, '');
    cleanLine = cleanLine.replace(/\{[^{}]*"([^"]*)"\s*:\s*\d+[^{}]*\}/g, '');

    // Remove pure-English quoted references "xxx" format
    cleanLine = cleanLine.replace(/\"[a-zA-Z][a-zA-Z\s\.\,\;\:\!\?\-\(\)\[\]\{\}\"\']*\"/g, '');

    // Remove backtick-wrapped code fragments
    cleanLine = cleanLine.replace(/`[^`]*`/g, '');

    if (cleanLine.trim()) {
      cleaned.push(cleanLine.trim());
    }
  }

  // Merge consecutive blank lines
  const result: string[] = [];
  for (const line of cleaned) {
    if (line === '' && result.length > 0 && result[result.length - 1] === '') continue;
    result.push(line);
  }

  const output = result.join('\n').trim();

  if (!output) {
    // No valid content; stay silent
  } else if (rawText.length - output.length >= Math.max(50, rawText.length * 0.01)) {
    const now = Date.now();
    if (now - lastReportTime >= REPORT_INTERVAL_MS) {
      lastReportTime = now;
      log.debug('思维链清理状态', { inputLength: rawText.length, outputLength: output.length });
    }
  }

  return output;
}

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}
