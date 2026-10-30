/**
 * 从 ISO 日期到今天经过的天数，未来日期按 0 计。
 *
 * 库存页显示「已存 N 天」和 AI 提示词里的「已存放N天」必须一致，
 * 所以只留这一份实现——两处各算一遍曾导致未来日期一处显示 0 天、一处显示负数。
 */
export function daysSince(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}
