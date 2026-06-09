import { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

export function useSafeJsonParam<T>(key: string): T | null {
  const params = useLocalSearchParams<Record<string, string>>();
  // raw 使用去掉 Json 后缀的参数 key
  const rawKey = key.endsWith('Json') ? key : `${key}Json`;
  const raw = params[rawKey];

  return useMemo(() => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed as T;
    } catch (e) {
      console.warn(`useSafeJsonParam: JSON解析失败 (${rawKey}):`, raw);
      return null;
    }
  }, [raw, rawKey]);
}
