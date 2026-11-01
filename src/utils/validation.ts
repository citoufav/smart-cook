export function validateApiKey(key: string): string | null {
  const trimmed = key.trim();
  if (trimmed.length < 16) return 'API Key 长度不能少于 16 个字符';
  if (/\s/.test(trimmed)) return 'API Key 不能包含空格';
  // 不强制 sk- 前缀：OpenAI 兼容渠道的 Key 格式各异（如智谱、月之暗面等）
  return null;
}
