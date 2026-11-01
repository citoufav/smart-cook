/**
 * 把模型返回的"松散数字"读成数字。
 *
 * 存在的理由：`z.coerce.number('200g')` 是 `NaN`，在兜底里会静默变成 `0`，
 * 而模型非常爱把克数写成 `"200g"`、把热量写成 `"290大卡"`。这个坑已经踩过两次
 * （一次菜名丢失、一次所有食材变成 0 克），所以单独抽出来、单独测。
 */

/** `200` / `"200g"` / `"约 200 克"` / `"290大卡"` → 数字；读不出来 → 0 */
export function readNumber(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === 'string') {
    const m = /-?\d+(?:\.\d+)?/.exec(raw);
    return m ? parseFloat(m[0]) : 0;
  }
  return 0;
}

/** 同一个值模型可能写在几个同义键里，按顺序取第一个能读成正数的 */
export function pickNumber(raw: any, keys: string[]): number {
  for (const k of keys) {
    const n = readNumber(raw?.[k]);
    if (n > 0) return n;
  }
  return 0;
}
