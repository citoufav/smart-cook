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
 * **颜色按食材该有的色系来取**（番茄红、小葱绿、胡萝卜橙），不是按名字散列。
 * 散列的毛病是"小葱变粉、豆腐变紫"，看着就是不认识这道菜。
 *
 * 刻意不让模型给颜色：跨次生成不稳定（同一道菜重做一次颜色就变）、
 * 给十六进制值无法保证深字读得清，还要多花输出 token，而且它也不保证不同食材不撞色。
 * 查表是确定的，而且覆盖了中式家常菜里绝大多数的常见食材。
 */
export interface TagColor {
  bg: string;
  text: string;
}

/** 色系：bg/text 的明度固定，只有色相跟着食材走，所以对比度永远够 */
interface HueFamily {
  h: number;
  s: number;
  l: number;
}

const FAMILIES: Record<string, HueFamily> = {
  red: { h: 0, s: 70, l: 86 },
  orange: { h: 28, s: 85, l: 84 },
  yellow: { h: 48, s: 80, l: 84 },
  green: { h: 120, s: 55, l: 84 },
  lime: { h: 85, s: 55, l: 84 },
  teal: { h: 175, s: 45, l: 82 },
  blue: { h: 210, s: 70, l: 86 },
  purple: { h: 275, s: 55, l: 87 },
  pink: { h: 335, s: 70, l: 87 },
  brown: { h: 24, s: 32, l: 82 },
  neutral: { h: 210, s: 10, l: 88 },
};

/** 食材 → 色系。子串匹配，先命中先算，所以更具体的放前面 */
const HUE_KEYWORDS: { family: keyof typeof FAMILIES; words: string[] }[] = [
  { family: 'red', words: ['番茄', '西红柿', '辣椒', '红椒', '小米辣', '干辣椒', '辣椒油', '枸杞', '红枣', '草莓', '西瓜', '番茄酱'] },
  { family: 'pink', words: ['虾', '蟹', '蟹棒', '三文鱼', '火腿', '培根'] },
  { family: 'orange', words: ['胡萝卜', '南瓜', '红薯', '橙', '咖喱', '咸蛋黄'] },
  { family: 'yellow', words: ['鸡蛋', '蛋', '玉米', '姜', '柠檬', '芒果', '菠萝', '黄豆', '豆芽'] },
  { family: 'green', words: ['葱', '蒜', '香菜', '韭菜', '青菜', '菠菜', '西兰花', '黄瓜', '冬瓜', '苦瓜', '青椒', '青豆', '豌豆', '芹菜', '莴笋', '芦笋', '生菜', '白菜', '油菜', '茼蒿', '空心菜', '豆角', '四季豆', '毛豆', '豆瓣'] },
  { family: 'lime', words: ['豆腐', '豆干', '腐竹', '豆皮'] },
  { family: 'brown', words: ['猪肉', '牛肉', '羊肉', '五花肉', '肉', '排骨', '木耳', '香菇', '蘑菇', '酱油', '生抽', '老抽', '醋', '料酒', '淀粉'] },
  { family: 'teal', words: ['紫菜', '海带', '虾皮', '鱼'] },
  { family: 'purple', words: ['茄子', '紫甘蓝', '洋葱'] },
  { family: 'blue', words: ['牛奶', '酸奶', '奶酪', '黄油'] },
  { family: 'neutral', words: ['大米', '米饭', '面粉', '面条', '馒头', '花卷', '年糕', '清水', '水', '盐', '糖', '白糖', '冰糖', '白胡椒', '味精', '鸡精', '土豆', '山药', '芋头', '莲藕', '粉丝', '粉条', '面包', '吐司', '意面'] },
  { family: 'yellow', words: ['食用油', '花生油', '菜籽油', '橄榄油', '香油'] },
];

/**
 * 认不出整词时，退一步看名字里的部件字。
 *
 * 表是有限的、食材是无限的，但中文食材名大多带语义词素：
 * 菜/苗/笋/瓜/芽 基本是绿的，鱼/虾是青的，肉/腩/排是棕的，米/面/薯是米色的，豆是豆绿的。
 * 这一层兜住"表里没有、但字面上猜得出来"的一大类，比一条条往表里塞划算得多。
 */
const CHARACTER_HINTS: { word: string; family: keyof typeof FAMILIES }[] = [
  { word: '萝卜', family: 'orange' },
  { word: '菜', family: 'green' },
  { word: '苗', family: 'green' },
  { word: '芽', family: 'green' },
  { word: '笋', family: 'green' },
  { word: '瓜', family: 'green' },
  { word: '菇', family: 'brown' },
  { word: '菌', family: 'brown' },
  { word: '肉', family: 'brown' },
  { word: '腩', family: 'brown' },
  { word: '腱', family: 'brown' },
  { word: '排', family: 'brown' },
  { word: '鱼', family: 'teal' },
  { word: '虾', family: 'pink' },
  { word: '蟹', family: 'pink' },
  { word: '蛋', family: 'yellow' },
  { word: '奶', family: 'blue' },
  { word: '酪', family: 'blue' },
  { word: '油', family: 'yellow' },
  { word: '米', family: 'neutral' },
  { word: '面', family: 'neutral' },
  { word: '薯', family: 'neutral' },
  { word: '藕', family: 'neutral' },
  { word: '豆', family: 'lime' },
];

/** 整词表拍平，避免每次查询都 flatMap */
const WHOLE_WORDS = HUE_KEYWORDS.flatMap(({ family, words }) =>
  words.map((word) => ({ word, family })),
);

/** 取最长命中：既要"番茄酱"压过"番茄"，也要"豆角"压过"豆" */
function familyOf(name: string): keyof typeof FAMILIES | null {
  const key = name.trim();
  if (!key) return null;

  const longest = (entries: { word: string; family: keyof typeof FAMILIES }[]) => {
    let found: { family: keyof typeof FAMILIES; len: number } | null = null;
    for (const e of entries) {
      if (key.includes(e.word) && (!found || e.word.length > found.len)) {
        found = { family: e.family, len: e.word.length };
      }
    }
    return found;
  };

  const whole = longest(WHOLE_WORDS);
  if (whole) return whole.family;

  // 整词没命中，才退到部件字
  return longest(CHARACTER_HINTS)?.family ?? null;
}

function colorFromHue(h: number, family: { s: number; l: number }): TagColor {
  const hue = Math.round(h) % 360;
  return {
    bg: `hsl(${hue}, ${family.s}%, ${family.l}%)`,
    text: `hsl(${hue}, ${Math.max(family.s, 45)}%, ${family.s < 20 ? 26 : 30}%)`,
  };
}

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** 单个食材的配色（没有整份菜单上下文时用） */
export function getTagColor(name: string): TagColor {
  const family = familyOf(name);
  if (family) return colorFromHue(FAMILIES[family].h, FAMILIES[family]);
  // 认不出来的，用黄金角散开，至少不会挤在一起
  return colorFromHue(hashName(name) % 360, { s: 55, l: 85 });
}

/**
 * 给一份菜单里出现的所有食材分配**互不相同**的颜色。
 *
 * 同一色系里有多样食材时（比如小葱、青椒、菠菜都是绿），把色相依次错开 10°，
 * 保证同屏不撞色；认不出色系的食材用黄金角往后排，避免都挤在一个位置。
 */
export function buildMenuIngredientColorMap(
  dishes: { ingredients: { name: string }[]; seasonings: { name: string }[] }[],
): Record<string, TagColor> {
  const names = dishes.flatMap((d) => [
    ...d.ingredients.map((i) => i.name),
    ...d.seasonings.map((s) => s.name),
  ]);

  const map: Record<string, TagColor> = {};
  const usedHues = new Set<number>();
  const unknownCount = { n: 0 };
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));

  const takeHue = (base: number): number => {
    let h = ((base % 360) + 360) % 360;
    for (let tries = 0; tries < 36 && usedHues.has(Math.round(h / 10) * 10); tries++) {
      h = (h + 10) % 360;
    }
    const bucket = Math.round(h / 10) * 10;
    usedHues.add(bucket % 360);
    return bucket;
  };

  for (const name of unique) {
    const family = familyOf(name);
    if (family) {
      const f = FAMILIES[family];
      map[name] = colorFromHue(takeHue(f.h), f);
    } else {
      const h = (unknownCount.n * 137.508) % 360;
      unknownCount.n += 1;
      map[name] = colorFromHue(takeHue(h), { s: 55, l: 85 });
    }
  }
  return map;
}
