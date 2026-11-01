/**
 * 从模型回复里抠出食材名。
 *
 * 单独一个文件、不 import 任何运行时东西，是为了能跑自检（`npm run check:vision`）——
 * 这块**没法对着真实模型验证**（没有 key），能断言的只有"乱七八糟的回复不该把应用搞崩、
 * 也不该把「约500g的五花肉（带皮）」这种整串塞进库存"。
 */

/** 一次识别最多收下这么多条：再多大概率是模型在凑数 */
export const MAX_SCANNED_ITEMS = 12;
/** 中文食材名很少超过 6 个字，留一倍余量 */
export const MAX_SCANNED_NAME_LENGTH = 12;

/** 把 "五花肉（约500g）" / "五花肉 500g" / "- 五花肉" 洗成 "五花肉" */
function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    // 括号里的都是数量/备注，整段丢掉
    .replace(/[（(【\[].*$/u, '')
    // 尾巴上的数量和单位
    .replace(/[\d.]+(?:kg|g|克|千克|斤|两|个|根|颗|袋|瓶|只|枚|片|把|头|ml|毫升)?\s*$/iu, '')
    // 前缀符号（列表符号、表情）。不用 \p{L}：Hermes 对 Unicode 属性转义的
    // 支持不像 Node 那样稳，显式写中文和字母更保险
    .replace(/^[^0-9a-zA-Z\u4e00-\u9fa5]+/u, '')
    .replace(/\s+/gu, '')
    .trim();
}

/** 从 JSON 值里取出候选名字：既接受 ["西红柿"]，也接受 {"items":[{"name":"西红柿"}]} */
function pickCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['items', 'ingredients', 'data', 'result']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

function candidateName(item: unknown): unknown {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    return obj.name ?? obj['名称'] ?? obj.title;
  }
  return '';
}

/**
 * @returns 干净、去重、有序的食材名；解析不出来就是空数组（调用方据此提示重试）
 */
export function parseScannedIngredients(raw: string): string[] {
  if (!raw) return [];

  // 模型爱用 ```json 包一层，也爱在 JSON 前面说一句"好的，图中包括："
  const unfenced = raw.replace(/```(?:json)?/giu, '').trim();
  const start = unfenced.search(/[[{]/u);
  if (start < 0) return [];
  const body = unfenced.slice(start);
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  if (end < 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(0, end + 1));
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of pickCandidates(parsed)) {
    const name = cleanName(candidateName(item));
    if (!name || name.length > MAX_SCANNED_NAME_LENGTH) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= MAX_SCANNED_ITEMS) break;
  }
  return names;
}
