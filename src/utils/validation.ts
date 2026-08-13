export function validateIngredientName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '食材名称不能为空';
  if (trimmed.length > 30) return '名称最多30个字符';
  return null;
}

export function validateIngredientWeight(weight: string): string | null {
  if (!weight.trim()) return null; // optional
  const num = parseFloat(weight);
  if (isNaN(num)) return '请输入有效的数字';
  if (num <= 0) return '请输入有效的重量 (大于0的数字)';
  if (num > 50000) return '重量不能超过 50000 克';
  if (!Number.isInteger(num)) return '请输入整数重量';
  return null;
}

export function validateSeasoningName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '调料名称不能为空';
  if (trimmed.length > 20) return '名称最多20个字符';
  return null;
}

export function validateApiKey(key: string): string | null {
  if (key.length < 16) return 'API Key 长度不能少于 16 个字符';
  if (!key.startsWith('sk-')) return 'API Key 必须以 sk- 开头';
  if (/\s/.test(key)) return 'API Key 不能包含空格';
  return null;
}

export function validateDietaryRestriction(text: string): string | null {
  if (!text.trim()) return '忌口不能为空';
  if (text.length > 200) return '忌口不能超过200个字符';
  return null;
}

export function validateUserNameExists(
  name: string,
  existingNames: string[],
  excludeName?: string,
): string | null {
  const trimmed = name.trim();
  if (existingNames.some((n) => n === trimmed && n !== excludeName)) {
    return '该名称已存在';
  }
  return null;
}
