/**
 * 食材标签解析的自检。跑法：
 *   node scripts/check-ingredient-tags.mjs
 *
 * 重点盯回归：旧正则会跨过 `]` 把相邻两个标签并成一个，界面上露出半截括号。
 */
import assert from 'node:assert/strict';
import { parseIngredientTags } from '../src/utils/ingredientTagParser.ts';
import { buildMenuIngredientColorMap, getTagColor } from '../src/constants/colors.ts';

const tags = (text) => parseIngredientTags(text).filter((s) => s.kind === 'tag');

// 1. 基本克重标签
let t = tags('取[小葱(10g)]洗净，切成葱花');
assert.equal(t.length, 1);
assert.deepEqual(t[0], { kind: 'tag', value: '小葱', amount: '10g', isGram: true });

// 2. 回归：两个相邻标签不得并成一个
//    旧实现 /\[(.+?)\((\S+?)\)\]/ 会把这段吃成单个 'A(B)] [C(10g)'
t = tags('[A(B)] [C(10g)]');
assert.equal(t.length, 2, `相邻标签被并成了一个：${JSON.stringify(t)}`);
assert.equal(t[0].value, 'A');
assert.equal(t[1].value, 'C');
assert.equal(t[1].isGram, true);

// 3. 一句话里多个标签
t = tags('加入[食用油(10g)]和[盐(3g)]，大火烧至六成热');
assert.deepEqual(t.map((x) => x.value), ['食用油', '盐']);
assert.deepEqual(t.map((x) => x.amount), ['10g', '3g']);

// 4. 非克重描述
t = tags('撒[盐(适量)]调味');
assert.equal(t.length, 1);
assert.equal(t[0].amount, '适量');
assert.equal(t[0].isGram, false);

// 5. 括号里带中文逗号补注：整段当描述，不拆
t = tags('[五花肉(200g，切片)]下锅');
assert.equal(t.length, 1);
assert.equal(t[0].value, '五花肉');
assert.equal(t[0].amount, '200g，切片');

// 6. 全角括号也要认
t = tags('[小葱（10g）]洗净');
assert.equal(t.length, 1);
assert.equal(t[0].amount, '10g');

// 7. 空格容错
t = tags('[小葱( 10 g )]洗净');
assert.equal(t[0].amount, '10g');

// 8. 未闭合的方括号：整段按原文输出，不吞字
const seg = parseIngredientTags('取[小葱(10g 洗净');
assert.equal(seg.length, 1);
assert.equal(seg[0].kind, 'text');
assert.equal(seg[0].value, '取[小葱(10g 洗净');

// 9. 普通文本原样保留
const plain = parseIngredientTags('洗净切段');
assert.deepEqual(plain, [{ kind: 'text', value: '洗净切段' }]);

// 10. 空串不产出片段
assert.deepEqual(parseIngredientTags(''), []);

// 11. 配色：同一份菜单里不同食材必须拿到不同颜色
//     （纯按名字散列取色是躲不开撞色的：18 色里装 10 种食材，不撞的概率只有几个百分点）
const dish = (ings, seas = []) => ({
  ingredients: ings.map((name) => ({ name })),
  seasonings: seas.map((name) => ({ name })),
});
const menu = [
  dish(['鸡蛋', '番茄', '小葱'], ['食用油', '盐']),
  dish(['豆腐', '猪肉', '大蒜', '淀粉', '生抽'], ['白砂糖']),
];
const colorMap = buildMenuIngredientColorMap(menu);
const bgs = Object.values(colorMap).map((c) => c.bg);
assert.equal(bgs.length, 11, `食材数量不对：${JSON.stringify(Object.keys(colorMap))}`);
assert.equal(new Set(bgs).size, bgs.length, `同一份菜单里出现了撞色：${JSON.stringify(bgs)}`);
assert.ok(
  Object.values(colorMap).every((c) => typeof c.bg === 'string' && typeof c.text === 'string'),
  '配色必须是 { bg, text } 成对的',
);

// 12. 重名食材只占一个颜色；空名单不炸
assert.equal(Object.keys(buildMenuIngredientColorMap([dish(['番茄']), dish(['番茄'])])).length, 1);
assert.deepEqual(buildMenuIngredientColorMap([]), {});

// 13. 没有整份菜单上下文时，单个名字也要能取到颜色
assert.ok(getTagColor('番茄').bg && getTagColor('番茄').text);

// 14. 颜色要跟着食材走，不是按名字乱散列 —— 散列出来的"小葱变粉、豆腐变紫"就是不认识这道菜
const hueOf = (name) => {
  const m = /hsl\((\d+)/.exec(getTagColor(name).bg);
  return m ? Number(m[1]) : -1;
};
assert.equal(hueOf('番茄'), 0, '番茄应该是红的');
assert.equal(hueOf('小葱'), 120, '小葱应该是绿的');
assert.equal(hueOf('胡萝卜'), 28, '胡萝卜应该是橙的');
assert.equal(hueOf('豆腐'), 85, '豆腐应该是豆制品那一档');
assert.equal(hueOf('大米'), 210, '大米应该是中性色');
assert.equal(hueOf('猪肉'), 24, '猪肉应该是偏棕色');

// 15. 关键词取最长匹配：咸蛋黄按"咸蛋黄"算（橙），不是按"蛋"算（黄）
assert.equal(hueOf('咸蛋黄'), 28, '长关键词没优先命中');
assert.equal(hueOf('鸡蛋'), 48, '鸡蛋应该是黄的');

// 16. 同一色系的多样食材也要错开色相，不能撞成一片
const twoGreens = buildMenuIngredientColorMap([dish(['小葱', '菠菜', '青椒'])]);
const greenBgs = ['小葱', '菠菜', '青椒'].map((n) => twoGreens[n].bg);
assert.equal(new Set(greenBgs).size, 3, `三种绿色食材撞色了：${JSON.stringify(greenBgs)}`);

// 17. 表收不全，靠部件字兜底：整词没命中时看"菜/腩/油"这类语素
assert.equal(hueOf('鸡毛菜'), 120, '带"菜"的应该按绿的算');
assert.equal(hueOf('牛腩'), 24, '带"腩"的应该按肉的棕色算');
assert.equal(hueOf('芝麻油'), 48, '带"油"的应该按油的黄色算');
assert.equal(hueOf('小油菜'), 120, '整词优先，仍是绿');

// 18. 真的认不出来的，也要有颜色且合法（只是语义上不保证）
assert.ok(/hsl\(/.test(getTagColor('迷迭香').bg));
assert.ok(/hsl\(/.test(getTagColor('迷迭香').text));

console.log('✓ 食材标签解析与配色 18 项全部通过');
