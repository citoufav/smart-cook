/**
 * 思维链文本清理工具
 * 过滤掉代码、JSON、英语片段、工具调用格式等，保留中文自然语言内容
 */

/**
 * 清理思维链文本，移除代码/JSON/纯英文行
 */
export function cleanThinkingText(rawText: string): string {
  const lines = rawText.split('\n');
  const cleaned: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // 保留空行作为段落分隔（但连续空行合并为一个）
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== '') {
        cleaned.push('');
      }
      continue;
    }

    // 跳过的行：
    // 1. Markdown 代码块标记
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) continue;

    // 2. 纯 JSON 结构（以 { [ 开头且不含中文）
    if (/^[\{\[].*[\}\]]$/.test(trimmed) && !containsChinese(trimmed)) continue;

    // 3. 以 data: 开头的 SSE 格式
    if (trimmed.startsWith('data:')) continue;

    // 4. 纯英文行（无任何中文字符且长于 3 字符）
    if (!containsChinese(trimmed) && trimmed.length > 3 && /^[a-zA-Z0-9\s\.\,\;\:\!\?\(\)\[\]\{\}\"\'\_\-\+\=\/\*\#\@\$\%\^\&\|\\\<\>\~]+$/.test(trimmed)) {
      // 但仍然保留短英文短语（如 "OK"）
      continue;
    }

    // 5. 函数调用格式（如 get_date(), call_xxx 等）
    if (/^[a-z_]+\s*\(.*\)\s*$/i.test(trimmed) && !containsChinese(trimmed)) continue;

    // 6. 工具调用相关行
    if (/^(Turn|Tool|function|reasoning_content|tool_calls|arguments)[\s\=:]/.test(trimmed)) continue;

    // 清理行内噪声
    let cleanLine = trimmed;

    // 移除行内的 JSON 片段（如 {"key": "value"}）
    cleanLine = cleanLine.replace(/\{[^{}]*"([^"]*)"\s*:\s*"[^"]*"[^{}]*\}/g, '');
    cleanLine = cleanLine.replace(/\{[^{}]*"([^"]*)"\s*:\s*\d+[^{}]*\}/g, '');

    // 移除纯英文括号引用 "xxx" 格式
    cleanLine = cleanLine.replace(/\"[a-zA-Z][a-zA-Z\s\.\,\;\:\!\?\-\(\)\[\]\{\}\"\']*\"/g, '');

    // 移除反引号包裹的代码片段
    cleanLine = cleanLine.replace(/`[^`]*`/g, '');

    if (cleanLine.trim()) {
      cleaned.push(cleanLine.trim());
    }
  }

  // 合并连续空行
  const result: string[] = [];
  for (const line of cleaned) {
    if (line === '' && result.length > 0 && result[result.length - 1] === '') continue;
    result.push(line);
  }

  return result.join('\n').trim();
}

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}
