export function parseWeight(text: string): number {
  if (!text) return 0;
  const match = text.match(/(\d+)\s*(?:g|克)/);
  if (match) return parseInt(match[1], 10);
  return 0;
}
