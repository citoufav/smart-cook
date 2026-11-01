/**
 * 「这个食材放得有点久了」的判定。
 *
 * **刻意不用 AI 判断。** 问模型"哪些快坏了"会得到一份每天都可能不同的答案：
 * 同一份库存，今天说猪肉不行、明天说行，用户没法核对。而这件事有明确依据 ——
 * 入库日期 + 食材种类，所以用本地表算，结果可解释、可复现、可测试。
 *
 * 模型那边其实早就看得到"已存放 N 天"（见 aiService.formatIngredientLines），
 * 它要不要因此调整菜单是它的事；这里只负责**提醒用户**，不替它做决定。
 *
 * 边界，很重要：
 * - 我们没有存冷藏/常温，表按**冷藏**给天数，常温的实际更短 —— 所以提示语一律用
 *   "可能"、"放得有点久"，绝不说"还能吃"。
 * - 只提醒，不阻断。判断食物还能不能吃是用户自己的事，也是唯一负责任的分工。
 */
export interface ShelfLifeItem {
  name: string;
  days: number;
  /** 这类食材大致能放多久，用来解释为什么提醒 */
  limit: number;
}

/** 冷藏条件下的经验天数（保守取小值）。没列到的按 7 天算，未知食材不该既不提醒也不管 */
const SHELF_LIFE_DAYS: { match: RegExp; days: number }[] = [
  // 生鲜肉禽水产：最要紧的一类
  { match: /(猪肉|牛肉|羊肉|鸡肉|鸭肉|排骨|里脊|五花|肉馅|猪肝|鸡翅|鸡腿)/, days: 3 },
  { match: /(鱼|虾|蟹|贝|鱿鱼|蛤蜊)/, days: 2 },
  // 豆制品、熟食
  { match: /(豆腐|豆干|豆皮|腐竹|豆浆)/, days: 3 },
  { match: /(火腿|香肠|培根|卤味|熟食)/, days: 5 },
  // 奶蛋
  { match: /(牛奶|酸奶|奶酪|奶油|鸡蛋|鸭蛋)/, days: 14 },
  // 蔬菜：叶菜短，根茎长
  { match: /(菠菜|生菜|青菜|油麦菜|香菜|小葱|韭菜|空心菜|茼蒿)/, days: 3 },
  { match: /(番茄|黄瓜|茄子|青椒|辣椒|西葫芦|西兰花|菜花|豆角|豇豆|蘑菇|香菇|金针菇)/, days: 7 },
  { match: /(土豆|洋葱|胡萝卜|萝卜|白菜|南瓜|冬瓜|山药|红薯|莲藕|玉米)/, days: 21 },
  // 主食干货
  { match: /(大米|面粉|面条|馒头|面包|杂粮|粉丝|粉条)/, days: 30 },
];

const DEFAULT_DAYS = 7;

export function shelfLifeDays(name: string): number {
  for (const rule of SHELF_LIFE_DAYS) {
    if (rule.match.test(name)) return rule.days;
  }
  return DEFAULT_DAYS;
}

/**
 * 挑出"放得有点久"的食材，最久的最靠前。
 *
 * @param ingredients 至少有 name 和 createDate
 * @param now 便于测试注入
 */
export function findAgingIngredients(
  ingredients: { name: string; createDate: string }[],
  now: Date = new Date(),
): ShelfLifeItem[] {
  const items: ShelfLifeItem[] = [];
  for (const ing of ingredients) {
    const name = (ing.name ?? '').trim();
    if (!name || !ing.createDate) continue;
    const created = new Date(ing.createDate);
    if (Number.isNaN(created.getTime())) continue;
    const days = Math.floor((now.getTime() - created.getTime()) / 86_400_000);
    const limit = shelfLifeDays(name);
    // 留一天余量再提醒：刚好到期的当天不必吓人，过一天才算"久了"
    if (days > limit) items.push({ name, days, limit });
  }
  return items.sort((a, b) => b.days - b.limit - (a.days - a.limit));
}
