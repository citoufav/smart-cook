/**
 * 拍照识别的自检。跑法：
 *   node scripts/check-vision.mjs
 *
 * 这块没法对着真实模型验证（没有 key 也不该有），能断言的是：
 * 模型回什么鬼样子，都不该让应用崩、也不该往库存里塞一串脏名字。
 */
import assert from 'node:assert/strict';
import { parseScannedIngredients, MAX_SCANNED_ITEMS } from '../src/utils/visionParse.ts';
import { buildChatBody } from '../src/utils/aiRequest.ts';

// 1. 标准回复
assert.deepEqual(
  parseScannedIngredients('{"items":[{"name":"西红柿"},{"name":"五花肉"}]}'),
  ['西红柿', '五花肉'],
);

// 2. 包在 markdown 围栏里 + 前面带一句解释
assert.deepEqual(
  parseScannedIngredients('好的，图中包括：\n```json\n{"items":[{"name":"鸡蛋"}]}\n```'),
  ['鸡蛋'],
  '围栏和前后废话都要能容忍',
);

// 3. 直接回数组、元素是字符串
assert.deepEqual(parseScannedIngredients('["土豆","白菜"]'), ['土豆', '白菜']);

// 4. 数量/重量/括号备注都要洗掉
assert.deepEqual(
  parseScannedIngredients('{"items":[{"name":"五花肉（约500g）"},{"name":"土豆 2个"},{"name":"- 鸡蛋"}]}'),
  ['五花肉', '土豆', '鸡蛋'],
);

// 5. 去重 + 保留顺序
assert.deepEqual(parseScannedIngredients('{"items":[{"name":"鸡蛋"},{"name":"鸡蛋"},{"name":"牛奶"}]}'), ['鸡蛋', '牛奶']);

// 6. 各种坏输入都不抛异常，一律空数组
for (const bad of ['', '我看不清这张图', '{不是json}', '{"items":null}', '{"items":[{"nope":1}]}', 'null']) {
  assert.deepEqual(parseScannedIngredients(bad), [], `坏输入应返回空数组：${bad}`);
}

// 7. 超长名字（一句话）不算食材名
assert.deepEqual(
  parseScannedIngredients('{"items":[{"name":"这是一个非常非常长的描述不应该进库存"}]}'),
  [],
  '超长的那条要丢掉，别当成食材',
);

// 8. 条数上限（名字里不能带数字：数字会被当成重量洗掉，30 条就缩成 1 条了）
const many = { items: Array.from({ length: 30 }, (_, i) => ({ name: `食材${String.fromCharCode(0x4e00 + i)}` })) };
const capped = parseScannedIngredients(JSON.stringify(many));
assert.equal(capped.length, MAX_SCANNED_ITEMS, `最多收 ${MAX_SCANNED_ITEMS} 条`);

// 9. 协议差异：同一份块数组，两家拼出来的形状不一样
const messages = [
  { role: 'system', content: '只输出 JSON' },
  { role: 'user', content: [
    { type: 'text', text: '照片里有什么食材' },
    { type: 'image', dataUrl: 'data:image/jpeg;base64,AAAABBBB' },
  ] },
];

const openaiBody = buildChatBody({ protocol: 'openai', model: 'deepseek-flash', messages, maxTokens: 600 });
const openaiBlocks = openaiBody.messages[1].content;
assert.equal(openaiBlocks.length, 2);
assert.deepEqual(openaiBlocks[1], {
  type: 'image_url',
  image_url: { url: 'data:image/jpeg;base64,AAAABBBB', detail: 'auto' },
});

const anthropicBody = buildChatBody({ protocol: 'anthropic', model: 'deepseek-flash', messages, maxTokens: 600 });
const anthropicBlocks = anthropicBody.messages[0].content;
assert.deepEqual(anthropicBlocks[1], {
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAABBBB' },
}, 'Anthropic 要把 data URL 拆成 media_type + data');

// 10. 纯文字消息保持字符串形状，别被无端改成块数组（老请求形状不能变）
const plain = buildChatBody({
  protocol: 'openai',
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: '做什么菜' }],
  maxTokens: 100,
});
assert.equal(plain.messages[0].content, '做什么菜');

// 11. 认不出的 data URL 直接丢掉，不允许拼进请求
const broken = buildChatBody({
  protocol: 'openai',
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: [{ type: 'image', dataUrl: 'https://example.com/a.jpg' }] }],
  maxTokens: 100,
});
assert.deepEqual(broken.messages[0].content, [], '非 base64 的图要丢掉');

console.log('✓ 拍照识别的解析与请求形状 11 组全部通过');
