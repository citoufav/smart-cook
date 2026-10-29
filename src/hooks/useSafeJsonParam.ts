import { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { logger } from '../utils/logger';

const log = logger('HOOK:JSON_PARAM');

export function useSafeJsonParam<T>(key: string): T | null {
  const params = useLocalSearchParams<Record<string, string>>();
  // raw uses the param key with the Json suffix removed
  const rawKey = key.endsWith('Json') ? key : `${key}Json`;
  const raw = params[rawKey];

  return useMemo(() => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed as T;
    } catch (e) {
      log.warn(`JSON解析失败 (${rawKey})`, String(e));
      return null;
    }
  }, [raw, rawKey]);
}
