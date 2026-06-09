export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '****';
  const start = apiKey.slice(0, 4);
  const end = apiKey.slice(-4);
  return `${start}****${end}`;
}
