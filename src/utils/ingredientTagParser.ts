/**
 * 把 AI 生成的步骤文案切成「普通文本 / 食材标签」两种片段。
 *
 * 格式约定来自 system prompt：`[食材名(克重)]`，例如 `取[小葱(10g)]洗净`。
 *
 * 关键约束：名字里不能再出现 [ ] （ ） ( )，描述里不能再出现方括号或括号。
 * 旧实现用 /\[(.+?)\((\S+?)\)\]/，其中的 `.` 能跨过 `]`，
 * 于是 `[A(B)] [C(10g)]` 会被并成一个标签 `A(B)] [C(10g)` —— 界面露出半截括号。
 * 这里用显式字符类封死跨标签匹配。
 */

export interface TagSegment {
  kind: 'text' | 'tag';
  /** kind === 'text'：原样文本。kind === 'tag'：食材名 */
  value: string;
  /** 仅 tag 有：括号内的用量，已归一化（如 `10g`、`适量`、`200g，切片`） */
  amount?: string;
  /** 仅 tag 有：括号内是否为纯克重，决定是否按重量样式强调 */
  isGram?: boolean;
}

const TAG_RE = /\[([^\[\]（）()]+?)[（(]([^\[\]（）()]*)[）)]\]/g;
const GRAM_RE = /^(\d+(?:\.\d+)?)\s*(?:g|克)$/i;

function classifyAmount(raw: string): { amount: string; isGram: boolean } {
  const trimmed = raw.trim();
  const gram = trimmed.match(GRAM_RE);
  if (gram) return { amount: `${gram[1]}g`, isGram: true };
  return { amount: trimmed, isGram: false };
}

export function parseIngredientTags(input: string): TagSegment[] {
  const segments: TagSegment[] = [];
  let cursor = 0;
  // 全局正则自带 lastIndex，复用实例前必须归零
  TAG_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(input)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: 'text', value: input.slice(cursor, match.index) });
    }
    const { amount, isGram } = classifyAmount(match[2]);
    segments.push({ kind: 'tag', value: match[1].trim(), amount, isGram });
    cursor = match.index + match[0].length;
  }

  if (cursor < input.length) {
    segments.push({ kind: 'text', value: input.slice(cursor) });
  }
  return segments;
}
