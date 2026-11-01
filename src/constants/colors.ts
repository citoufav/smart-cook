export const COLORS = {
  primary: '#FF6B35',
  primaryLight: '#FF8C5A',
  primaryDark: '#E55A2B',
  primaryBg: '#FFF0E6',
  
  textPrimary: '#1A1A1A',
  textBody: '#495057',
  textSecondary: '#6C757D',
  textTertiary: '#ADB5BD',
  textWhite: '#FFFFFF',
  
  background: '#FAFAFA',
  surface: '#FFFFFF',
  border: '#E8E8E8',
  borderLight: '#F0F0F0',
  
  success: '#2D9F4E',
  successLight: '#D4EDDA',
  successText: '#155724',
  warning: '#FFC107',
  warningLight: '#FFF3CD',
  warningText: '#856404',
  danger: '#D32F2F',
  dangerLight: '#F8D7DA',
  dangerText: '#721C24',
  info: '#2196F3',
  infoLight: '#E3F2FD',
  infoText: '#0D47A1',
  
  neutral: '#9E9E9E',
  neutralLight: '#F5F5F5',
  
  overlay: 'rgba(0,0,0,0.5)',
  shadow: 'rgba(0,0,0,0.1)',
} as const;

export const SEASONING_STATUS_LABEL: Record<string, string> = {
  sufficient: '充足',
  low: '少量',
  out: '缺少',
};

export const SEASONING_STATUS_COLORS = {
  sufficient: { bg: '#D4EDDA', text: '#155724' },
  low: { bg: '#FFF3CD', text: '#856404' },
  out: { bg: '#F8D7DA', text: '#721C24' },
} as const;

/**
 * 食材标签配色。
 *
 * 浅底 + 深字的「软标签」写法，而不是深底白字的实色块：备菜/炒制页是长段正文，
 * 实色块会把注意力从读步骤上抢走，而且深色块彼此之间本来就难分辨。
 *
 * 刻意不用模型返回的颜色：跨次生成不稳定，还容易给出对比度不足的浅色。
 */
export interface TagColor {
  bg: string;
  text: string;
}

export const TAG_PALETTE: TagColor[] = [
  { bg: '#BBDEFB', text: '#0D47A1' }, // 蓝
  { bg: '#B3E5FC', text: '#01579B' }, // 天蓝
  { bg: '#B2EBF2', text: '#006064' }, // 青
  { bg: '#B2DFDB', text: '#004D40' }, // 青绿
  { bg: '#C8E6C9', text: '#1B5E20' }, // 绿
  { bg: '#DCEDC8', text: '#33691E' }, // 草绿
  { bg: '#F0F4C3', text: '#5D6B0F' }, // 黄绿
  { bg: '#FFF9C4', text: '#7A5F00' }, // 黄
  { bg: '#FFECB3', text: '#8A5300' }, // 琥珀
  { bg: '#FFCCBC', text: '#BF360C' }, // 橙
  { bg: '#FFCDD2', text: '#B71C1C' }, // 红
  { bg: '#F8BBD0', text: '#880E4F' }, // 粉
  { bg: '#E1BEE7', text: '#4A148C' }, // 紫
  { bg: '#D1C4E9', text: '#311B92' }, // 深紫
  { bg: '#C5CAE9', text: '#1A237E' }, // 靛
  { bg: '#CFD8DC', text: '#263238' }, // 蓝灰
  { bg: '#D7CCC8', text: '#3E2723' }, // 棕
  { bg: '#E0E0E0', text: '#37474F' }, // 灰
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** 单个食材的配色（没有整份菜单上下文时用） */
export function getTagColor(name: string): TagColor {
  return TAG_PALETTE[hashName(name) % TAG_PALETTE.length];
}

/**
 * 给一份菜单里出现的所有食材分配**互不相同**的颜色。
 *
 * 光按名字散列取色是躲不开撞色的：18 个颜色里装 10 种食材，不撞的概率只有几个百分点。
 * 所以先用名字定一个基准位（同一食材大体稳定），被占了就顺延到下一个空位。
 * 代价是同一个食材在不同菜单里可能换个颜色，换来的是同一屏内永远不撞色。
 */
export function buildMenuIngredientColorMap(
  dishes: { ingredients: { name: string }[]; seasonings: { name: string }[] }[],
): Record<string, TagColor> {
  const names = dishes.flatMap((d) => [
    ...d.ingredients.map((i) => i.name),
    ...d.seasonings.map((s) => s.name),
  ]);

  const map: Record<string, TagColor> = {};
  const used = new Set<number>();
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));

  for (const name of unique) {
    let idx = hashName(name) % TAG_PALETTE.length;
    for (let tries = 0; tries < TAG_PALETTE.length && used.has(idx); tries++) {
      idx = (idx + 1) % TAG_PALETTE.length;
    }
    used.add(idx);
    map[name] = TAG_PALETTE[idx];
  }
  return map;
}
