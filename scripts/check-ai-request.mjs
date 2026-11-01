/**
 * 请求体协议差异的自检。跑法：
 *   node scripts/check-ai-request.mjs
 *
 * 为什么这个要单独测：两种协议的 body 形状不一样，而这块**没法对着真实 API 验证**
 * （没有 key，也不该把 key 放进仓库）。能断言的最少是：
 * 该有的字段有、不该有的字段没跑出来、思考预算不会超过 max_tokens。
 */
import assert from 'node:assert/strict';
import { buildChatBody } from '../src/utils/aiRequest.ts';
import { HEALTH_CONDITIONS, findConditionByRule } from '../src/constants/healthConditions.ts';

const messages = [
  { role: 'system', content: '你是厨师' },
  { role: 'user', content: '做什么菜' },
];

// 1. OpenAI 兼容：system 留在 messages 里，json 参数照发
let body = buildChatBody({
  protocol: 'openai',
  model: 'gpt-4o-mini',
  messages,
  maxTokens: 8000,
  json: true,
});
assert.equal(body.stream, true);
assert.equal(body.max_tokens, 8000);
assert.equal(body.messages.length, 2, 'OpenAI 协议的 system 必须留在 messages 里');
assert.deepEqual(body.response_format, { type: 'json_object' });
assert.equal(body.thinking, undefined, '没开思考时不该出现 thinking 字段');
assert.equal(body.system, undefined, 'OpenAI 协议没有顶层 system');

// 2. DeepSeek 开了思考：type + reasoning_effort 一起给
body = buildChatBody({
  protocol: 'openai',
  model: 'deepseek-flash',
  messages,
  maxTokens: 32000,
  thinking: { enabled: true, effort: 'max' },
});
assert.deepEqual(body.thinking, { type: 'enabled' });
assert.equal(body.reasoning_effort, 'max');
assert.equal(body.response_format, undefined, '没要求 JSON 就不该带 response_format');

// 3. DeepSeek 明确关思考：要显式发 disabled（它支持关掉，别家没这个字段）
body = buildChatBody({
  protocol: 'openai',
  model: 'deepseek-flash',
  messages,
  maxTokens: 8000,
  thinking: { enabled: false },
});
assert.deepEqual(body.thinking, { type: 'disabled' });
assert.equal(body.reasoning_effort, undefined);

// 4. Anthropic：system 提到顶层，messages 里不能再有 system
body = buildChatBody({
  protocol: 'anthropic',
  model: 'claude-sonnet-4-5',
  messages,
  maxTokens: 8000,
  json: true,
});
assert.equal(body.system, '你是厨师');
assert.equal(body.messages.length, 1, 'Anthropic 的 messages 里不能有 system');
assert.equal(body.messages[0].role, 'user');
assert.equal(body.response_format, undefined, 'Anthropic 没有 response_format，硬塞会 400');
assert.equal(body.stream, true);
assert.equal(body.max_tokens, 8000);

// 5. Anthropic 多条 system 要合并（不能用数组塞进去）
body = buildChatBody({
  protocol: 'anthropic',
  model: 'claude-sonnet-4-5',
  messages: [
    { role: 'system', content: 'A' },
    { role: 'system', content: 'B' },
    { role: 'user', content: 'C' },
  ],
  maxTokens: 8000,
});
assert.equal(body.system, 'A\n\nB');

// 6. Anthropic 思考预算：必须小于 max_tokens，且按档位给
body = buildChatBody({
  protocol: 'anthropic',
  model: 'claude-sonnet-4-5',
  messages,
  maxTokens: 32000,
  thinking: { enabled: true, effort: 'max' },
});
assert.equal(body.thinking.type, 'enabled');
assert.equal(body.thinking.budget_tokens, 8192);
assert.ok(body.thinking.budget_tokens < body.max_tokens);

body = buildChatBody({
  protocol: 'anthropic',
  model: 'claude-sonnet-4-5',
  messages,
  maxTokens: 2000,
  thinking: { enabled: true, effort: 'max' },
});
assert.ok(
  body.thinking.budget_tokens < 2000,
  `预算 ${body.thinking.budget_tokens} 不能大于等于 max_tokens 2000`,
);

// 7. Anthropic 没开思考：不该出现 thinking 字段
body = buildChatBody({
  protocol: 'anthropic',
  model: 'claude-sonnet-4-5',
  messages,
  maxTokens: 8000,
  thinking: { enabled: false },
});
assert.equal(body.thinking, undefined);

// 8. 疾病预设存的是"标签：具体做法"整串，AI 才不会被"糖尿病"三个字自由发挥
const diabetes = HEALTH_CONDITIONS.find((c) => c.label === '糖尿病');
assert.ok(diabetes, '糖尿病预设没了');
assert.ok(diabetes.rule.includes('控糖'), `糖尿病那条要写清"控糖"，现在是：${diabetes.rule}`);
assert.ok(diabetes.rule.includes('糖尿病'), '存的整串要带病名，否则用户在忌口列表里看不出这是什么');
assert.equal(findConditionByRule(diabetes.rule)?.label, '糖尿病');
assert.equal(findConditionByRule('不吃香菜'), undefined, '用户自己敲的忌口不该被认成预设');
for (const c of HEALTH_CONDITIONS) {
  assert.ok(c.rule.startsWith(`${c.label}：`), `${c.label} 的规则要写成「标签：做法」`);
}

console.log('✓ AI 请求体协议差异 8 组全部通过');
