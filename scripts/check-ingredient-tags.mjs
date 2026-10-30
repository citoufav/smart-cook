/**
 * 食材标签解析的自检。跑法：
 *   node scripts/check-ingredient-tags.mjs
 *
 * 重点盯回归：旧正则会跨过 `]` 把相邻两个标签并成一个，界面上露出半截括号。
 */
import assert from 'node:assert/strict';
import { parseIngredientTags } from '../src/utils/ingredientTagParser.ts';

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

console.log('✓ 食材标签解析 10 项全部通过');
