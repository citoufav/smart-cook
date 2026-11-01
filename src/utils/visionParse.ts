/**
 * 从模型回复里抠出食材和调料。
 *
 * 单独一个文件、不 import 任何运行时东西，是为了能跑自检（`npm run check:vision`）——
 * 这块**没法对着真实模型验证**（没有 key），能断言的只有"乱七八糟的回复不该把应用搞崩、
 * 也不该把「约500g的五花肉（带皮）」这种整串塞进库存"。
 *
 * 为什么要分类：调料在应用里是另一套数据（有"够/少/没了"状态，做菜时单独喂给模型），
 * 混进食材会同时坏掉两件事 —— 调料页看不到它，而且 AI 会以为你没有这瓶酱油。
 */

/** 一次识别最多收下这么多条（食材+调料合计）：再多大概率是模型在凑数 */
export const MAX_SCANNED_ITEMS = 12;
/** 中文食材名很少超过 6 个字，留一倍余量 */
export const MAX_SCANNED_NAME_LENGTH = 12;

export interface ScannedItems {
  ingredients: string[];
  seasonings: string[];
}

/** 模型可能给的几种"这是调料"的写法 */
const SEASONING_KINDS = new Set(['seasoning', 'condiment', '调料', '调味料', '調味料']);

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

/** 从 JSON 值里取出候选：「items」数组，或直接一个数组 */
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

function candidateKind(item: unknown): unknown {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    return obj.kind ?? obj.type ?? obj.category ?? obj['类别'];
  }
  return undefined;
}

function isSeasoning(item: unknown): boolean {
  const kind = candidateKind(item);
  return typeof kind === 'string' && SEASONING_KINDS.has(kind.trim().toLowerCase());
}

/**
 * @returns 分好类的名字；解析不出来就是两个空数组（调用方据此提示重试）
 *
 * 判不出类别的按**食材**处理：调料漏在这里最多是去食材页挪一下，
 * 而食材被误记成调料，做菜时会直接从主料清单里消失。
 */
export function parseScannedItems(raw: string): ScannedItems {
  const empty: ScannedItems = { ingredients: [], seasonings: [] };
  if (!raw) return empty;

  // 模型爱用 ```json 包一层，也爱在 JSON 前面说一句"好的，图中包括："
  const unfenced = raw.replace(/```(?:json)?/giu, '').trim();
  const start = unfenced.search(/[[{]/u);
  if (start < 0) return empty;
  const body = unfenced.slice(start);
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  if (end < 0) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(0, end + 1));
  } catch {
    return empty;
  }

  const seen = new Set<string>();
  const result: ScannedItems = { ingredients: [], seasonings: [] };
  let total = 0;
  for (const item of pickCandidates(parsed)) {
    const name = cleanName(candidateName(item));
    if (!name || name.length > MAX_SCANNED_NAME_LENGTH) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    result[isSeasoning(item) ? 'seasonings' : 'ingredients'].push(name);
    if (++total >= MAX_SCANNED_ITEMS) break;
  }
  return result;
}
