/** 解析用量文本中的重量，统一返回整数克（库存重量为整数） */
export function parseWeight(text: string): number {
  if (!text) return 0;
  // 克：支持小数，如 "200g" / "200.5克"
  const gramMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:g|克)/i);
  if (gramMatch) return Math.round(parseFloat(gramMatch[1]));
  // 千克：如 "0.5kg" / "1千克" / "2公斤"
  const kgMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:kg|千克|公斤)/i);
  if (kgMatch) return Math.round(parseFloat(kgMatch[1]) * 1000);
  return 0;
}
