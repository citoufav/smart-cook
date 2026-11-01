import type { UserPreferences } from '../types';
import { aiBody, aiEndpoint, aiHeaders, aiProtocol } from './aiClient';
import { parseScannedItems, type ScannedItems } from '../utils/visionParse';
import { logger } from '../utils/logger';

const log = logger('SVC:VISION');

/**
 * 提示词写在这个文件里，和 aiService 的菜谱提示词分开：
 * 这个是"只许报名字"的机械活，混进做饭那套规则只会让它自由发挥。
 */
const SYSTEM_PROMPT = `你是厨房助理。看照片，列出画面里能吃的食材和用得到的调料。
只输出 JSON，形如：{"items":[{"name":"西红柿","kind":"ingredient"},{"name":"生抽","kind":"seasoning"}]}
规则：
- 每条都必须带 kind：主料、配菜、主食写 ingredient；油盐酱醋、糖、料酒、淀粉、豆瓣酱、香料写 seasoning
- 名字用常见中文说法，2~6 个字；不要写品牌、包装、数量、重量、做法
- 厨具、餐具、桌布、人不要写
- 拿不准或看不清就跳过，宁少勿多
- 不要解释，不要 markdown`;

/** 单次识别的上限：照片不用长，800 token 足够列 20 条 */
const MAX_TOKENS = 800;
const TIMEOUT_MS = 60000;

export interface RecognizeResult {
  ok: boolean;
  items: ScannedItems;
  /** 给用户看的一句话，失败时才有 */
  error?: string;
}

function messageText(raw: any, protocol: 'openai' | 'anthropic'): string {
  if (protocol === 'anthropic') {
    const blocks = Array.isArray(raw?.content) ? raw.content : [];
    return blocks
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('');
  }
  return typeof raw?.choices?.[0]?.message?.content === 'string' ? raw.choices[0].message.content : '';
}

/**
 * 拍一张照片 → 让模型报出食材名。
 *
 * 图片以 base64 data URL 内联发出去，不走 DeepSeek 的 Files API：
 * 一次请求就完事，也不用管上传文件什么时候过期。图片本身不落盘、不留历史。
 */
export async function recognizeIngredients(
  prefs: UserPreferences,
  dataUrl: string,
): Promise<RecognizeResult> {
  const protocol = aiProtocol(prefs);

  // aiBody 默认 stream: true；这里要一次拿完结果，所以显式关掉。
  // 两种协议关掉 stream 后都是普通 JSON 响应，解析分支见 messageText。
  const body = {
    ...aiBody(prefs, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '照片里有哪些食材？只报名字。' },
            { type: 'image', dataUrl },
          ],
        },
      ],
      maxTokens: MAX_TOKENS,
      thinking: 'off',
      json: true,
    }),
    stream: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(aiEndpoint(prefs), {
      method: 'POST',
      headers: aiHeaders(prefs),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      // 原文截一段给用户：换模型/换渠道时，后端那句话比"识别失败"有用得多
      const detail = (await res.text().catch(() => '')).slice(0, 160);
      log.error('识图请求失败', { status: res.status, detail });
      return {
        ok: false,
        items: { ingredients: [], seasonings: [] },
        error: `识别失败（HTTP ${res.status}）${detail ? `：${detail}` : ''}`,
      };
    }

    const raw = await res.json();
    const text = messageText(raw, protocol);
    const items = parseScannedItems(text);
    const total = items.ingredients.length + items.seasonings.length;
    log.info('识图完成', { total, ingredients: items.ingredients.length, seasonings: items.seasonings.length });
    if (total === 0) {
      return { ok: false, items, error: '没认出食材，换个角度再拍一张试试' };
    }
    return { ok: true, items };
  } catch (e: any) {
    const aborted = e?.name === 'AbortError';
    log.error('识图异常', { aborted, error: String(e) });
    return {
      ok: false,
      items: { ingredients: [], seasonings: [] },
      error: aborted ? '识别超时了，网络慢或图片太大' : `识别失败：${String(e?.message ?? e).slice(0, 120)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
