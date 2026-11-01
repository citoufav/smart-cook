/**
 * 拍照识别的自检。跑法：
 *   node scripts/check-vision.mjs
 *
 * 这块没法对着真实模型验证（没有 key 也不该有），能断言的是：
 * 模型回什么鬼样子，都不该让应用崩、不该往库存里塞一串脏名字，
 * 也不该把调料当食材写进库存。
 */
import assert from 'node:assert/strict';
import { parseScannedItems, MAX_SCANNED_ITEMS } from '../src/utils/visionParse.ts';
import { buildChatBody } from '../src/utils/aiRequest.ts';

const empty = { ingredients: [], seasonings: [] };

// 1. 标准回复：按 kind 分两组
assert.deepEqual(
  parseScannedItems('{"items":[{"name":"西红柿","kind":"ingredient"},{"name":"生抽","kind":"seasoning"}]}'),
  { ingredients: ['西红柿'], seasonings: ['生抽'] },
);

// 2. 没给 kind 的按食材处理（食材被误记成调料会从主料清单里消失，反过来只是挪一下）
assert.deepEqual(
  parseScannedItems('{"items":[{"name":"鸡蛋"}]}'),
  { ingredients: ['鸡蛋'], seasonings: [] },
);

// 3. 中文 kind 和别的写法都认
assert.deepEqual(
  parseScannedItems('{"items":[{"name":"盐","kind":"调料"},{"name":"料酒","type":"condiment"},{"name":"土豆","kind":"ingredient"}]}'),
  { ingredients: ['土豆'], seasonings: ['盐', '料酒'] },
);

// 4. 包在 markdown 围栏里 + 前面带一句解释
assert.deepEqual(
  parseScannedItems('好的，图中包括：\n```json\n{"items":[{"name":"鸡蛋","kind":"ingredient"}]}\n```'),
  { ingredients: ['鸡蛋'], seasonings: [] },
  '围栏和前后废话都要能容忍',
);

// 5. 直接回数组、元素是字符串
assert.deepEqual(parseScannedItems('["土豆","白菜"]'), { ingredients: ['土豆', '白菜'], seasonings: [] });

// 6. 数量/重量/括号备注都要洗掉
assert.deepEqual(
  parseScannedItems('{"items":[{"name":"五花肉（约500g）","kind":"ingredient"},{"name":"土豆 2个"},{"name":"- 鸡蛋"}]}'),
  { ingredients: ['五花肉', '土豆', '鸡蛋'], seasonings: [] },
);

// 7. 去重（跨组也算同一个名字，不能既在食材又在调料）
assert.deepEqual(
  parseScannedItems('{"items":[{"name":"鸡蛋"},{"name":"鸡蛋"},{"name":"盐","kind":"seasoning"},{"name":"盐","kind":"ingredient"}]}'),
  { ingredients: ['鸡蛋'], seasonings: ['盐'] },
);

// 8. 各种坏输入都不抛异常，一律空
for (const bad of ['', '我看不清这张图', '{不是json}', '{"items":null}', '{"items":[{"nope":1}]}', 'null']) {
  assert.deepEqual(parseScannedItems(bad), empty, `坏输入应返回空：${bad}`);
}

// 9. 超长名字（一句话）不算食材名
assert.deepEqual(
  parseScannedItems('{"items":[{"name":"这是一个非常非常长的描述不应该进库存"}]}'),
  empty,
  '超长的那条要丢掉，别当成食材',
);

// 10. 条数上限（名字里不能带数字：数字会被当成重量洗掉，30 条就缩成 1 条了）
const many = {
  items: Array.from({ length: 30 }, (_, i) => ({
    name: `食材${String.fromCharCode(0x4e00 + i)}`,
    kind: i % 2 === 0 ? 'ingredient' : 'seasoning',
  })),
};
const capped = parseScannedItems(JSON.stringify(many));
assert.equal(
  capped.ingredients.length + capped.seasonings.length,
  MAX_SCANNED_ITEMS,
  `最多收 ${MAX_SCANNED_ITEMS} 条`,
);
assert.ok(capped.ingredients.length > 0 && capped.seasonings.length > 0, '分组不该吃掉其中一类');

// 11. 协议差异：同一份块数组，两家拼出来的形状不一样
const messages = [
  { role: 'system', content: '只输出 JSON' },
  { role: 'user', content: [
    { type: 'text', text: '照片里有什么' },
    { type: 'image', dataUrl: 'data:image/jpeg;base64,AAAABBBB' },
  ] },
];

const openaiBody = buildChatBody({ protocol: 'openai', model: 'deepseek-flash', messages, maxTokens: 600 });
assert.deepEqual(openaiBody.messages[1].content[1], {
  type: 'image_url',
  image_url: { url: 'data:image/jpeg;base64,AAAABBBB', detail: 'auto' },
});

const anthropicBody = buildChatBody({ protocol: 'anthropic', model: 'deepseek-flash', messages, maxTokens: 600 });
assert.deepEqual(anthropicBody.messages[0].content[1], {
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAABBBB' },
}, 'Anthropic 要把 data URL 拆成 media_type + data');

// 12. 纯文字消息保持字符串形状，别被无端改成块数组（老请求形状不能变）
const plain = buildChatBody({
  protocol: 'openai',
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: '做什么菜' }],
  maxTokens: 100,
});
assert.equal(plain.messages[0].content, '做什么菜');

// 13. 认不出的 data URL 直接丢掉，不允许拼进请求
const broken = buildChatBody({
  protocol: 'openai',
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: [{ type: 'image', dataUrl: 'https://example.com/a.jpg' }] }],
  maxTokens: 100,
});
assert.deepEqual(broken.messages[0].content, [], '非 base64 的图要丢掉');

console.log('✓ 拍照识别的解析（含食材/调料分类）与请求形状 13 组全部通过');
