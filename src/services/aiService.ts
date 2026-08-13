import { UserPreferences } from '../types';
import { DEFAULT_TIMEOUT_MS, MAX_RETRIES, BASE_RETRY_DELAY_MS } from '../constants/cooking';
import { sseStreamFetch, SSEStreamController } from '../utils/sseStream';
import { logger } from '../utils/logger';

const log = logger('SVC:AI');

function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

function buildThinkingConfig(prefs: UserPreferences): { thinking: { type: 'enabled' | 'disabled' }; reasoning_effort?: 'high' | 'max' } {
  if (prefs.thinkingEnabled) {
    return {
      thinking: { type: 'enabled' },
      reasoning_effort: prefs.reasoningEffort,
    };
  }
  return { thinking: { type: 'disabled' } };
}

function getRetryDelay(attempt: number): number {
  const base = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 500;
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildHeaders(prefs: UserPreferences): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${prefs.apiKey}`,
  };
}

export const SYSTEM_PROMPT_CN = `你是一位专业的家庭厨师和营养顾问。请严格遵循以下规则，每条规则附有示例。

【基本规则】
1. 优先消耗库存：首先使用库存中已有的食材和调料。
2. 最小化采买：尽量减少需要额外购买的食材和调料。
3. 统一单位：所有食材重量单位为"克"（g），调料在菜单规划阶段可用"适量/少许"等描述，在炒制步骤中必须给克重数字。
4. 严格 JSON：只返回纯 JSON，禁止用 \`\`\`json\`\`\` 包裹，禁止输出任何非 JSON 文本。
5. 全局一致性：生成前先通盘考虑备菜→炒制全流程，确保步骤衔接无矛盾。
6. 主食=菜品：米饭、馒头、面条、花卷、烙饼等主食与炒菜一样是独立菜品，必须包含在 dishes 中，有独立的 estimatedNutrition。

【营养与搭配】
7. 成年男性 600-800 大卡/餐，成年女性 500-600 大卡/餐。
8. 早餐 300-500 大卡，20 分钟内可完成。
9. 午餐/晚餐根据人数和热量目标合理搭配，荤素搭配，有主食。
10. 中餐为主，1人份主料 150-300g。

【备菜步骤 — 重要】
11. 相同食材、相同切配方式 → 必须合并为一个备菜步骤。
    ✅ 正确：小葱共10g，切葱花。description: "取[小葱(10g)]洗净，切成葱花"（多道菜品共用时只写一条，说明总量）
    ❌ 错误：小葱切葱花（紫菜蛋花汤）+ 小葱切葱花（凉拌西兰花）写成两个步骤
12. prepSteps 格式：每条包含 id("prep-N")、ingredientName(食材名)、quantity(用量如"200g")、dishName(所属菜品名)、description(操作描述)、isCompleted(false)、order(从1递增)。
    description 中用 [食材名(克重)] 引用食材，严禁提碗编号。
    ✅ 正确："淘洗[大米(200g)]，换水浸泡20分钟后沥干"
    ❌ 错误：提及碗编号、写入碗1/碗2，或写比例"水米1:1.2"

【炒制步骤 — 重要】
13. 新手友好：每一步操作写明确切的克数、温度和时间。
    ✅ 正确："锅中加入[食用油(10g)]，烧至六成热（约160°C），放入[蒜末(5g)]爆香..."
    ❌ 错误："水米比例1:1.2"、"油温适中"、"适量加水"、"焖至熟"
    煮米饭等需要加水的操作：必须写确切水量，如"加入清水300g，大火煮沸后转小火焖15分钟"
14. cookingSteps.instruction 中用 [食材名(克重)] 引用食材，严禁使用 [碗N] 等碗编号写法。
    ✅ 正确："将[猪肉丝(150g)]倒入锅中，加入[清水(300g)]，大火煮沸"
    ❌ 错误：使用 [碗1]、[碗2] 等碗编号引用
15. cookingSteps 格式：每条包含 stepNumber(从1递增)、dishName(对应菜品名)、instruction(炒制说明)、bowlReferences([] 固定空数组)、isCompleted(false)。

【其他规则】
16. 调料必须给出克重数字：油类、酱油、醋、料酒、盐、糖、淀粉等一律用 [调料名(Xg)] 格式，禁止"适量/少许/X勺"。只有粉状调料（花椒粉、胡椒粉、十三香等）可用1-5g范围。
17. 食材不足时 dishes 数组不能为空，至少给出 1 道利用现有食材的简易菜（蛋炒饭、拌面、炒时蔬等）。
18. 所有输出使用中文。
19. **标签格式严格要求**：[食材名(克重)] 标签的方括号必须完整闭合，不允许出现 清水(120g 等断括号。油类（食用油、香油等）必须给出克重数字。`;

function buildStage1UserPrompt(
  ingredients: { name: string; weight: number | null; createDate: string }[],
  seasonings: { name: string; status: string }[],
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
  dietaryRestrictions: string[],
  recentMeals?: string[],
): string {
  const statusLabel: Record<string, string> = { sufficient: '充足', low: '少量', out: '缺少' };

  const ingredientLines = ingredients.length > 0
    ? ingredients
        .sort((a, b) => new Date(a.createDate).getTime() - new Date(b.createDate).getTime())
        .map((ing, i) => {
          const days = Math.floor((Date.now() - new Date(ing.createDate).getTime()) / 86400000);
          return `${i + 1}. ${ing.name}：${ing.weight !== null ? ing.weight + '克' : '重量未知'}（已存放${days}天）`;
        })
        .join('\n')
    : '库存中暂无食材。';

  const seasoningLines = seasonings.length > 0
    ? seasonings.map((s) => `- ${s.name}：${statusLabel[s.status] || s.status}`).join('\n')
    : '库存中暂无调料记录。';

  const calorieText = requirement.caloriePreference
    ? `热量目标：每人约${requirement.caloriePreference}大卡，${requirement.personCount}人总计约${requirement.caloriePreference * requirement.personCount}大卡，请确保所有菜品热量总和接近此目标`
    : `热量目标：不限，请根据${requirement.personCount}人份的营养指南合理搭配`;

  const customText = requirement.customRequirement ? `特殊需求：${requirement.customRequirement}` : '';
  const restrictionText = dietaryRestrictions.length > 0 ? `忌口：${dietaryRestrictions.join(', ')}` : '';

  const dietMemoryText = recentMeals && recentMeals.length > 0
    ? `\n【饮食记忆】\n用户最近吃过的菜：${recentMeals.join('、')}\n请避免推荐与以上重复的菜品。`
    : '';

  return `【基本信息】
用餐人数：${requirement.personCount}人
餐类：${requirement.mealType}
${calorieText}
${customText}
${restrictionText}
${dietMemoryText}

【库存食材】
${ingredientLines}

【库存调料】
${seasoningLines}

请严格按照以下 JSON Schema 返回，确保 dishes 数组至少包含 1 道菜品。

【prepSteps 生成规则】
- 覆盖所有需要切/洗/腌制的食材，相同切配方式必须合并为一个步骤
- description 中用 [食材名(克重)] 引用食材，严禁提碗编号
- 示例：多道菜都用到葱花 → 合并为 "取[小葱(10g)]洗净，切成葱花"

【cookingSteps 生成规则】
- 按 cookingOrder 建议的顺序排列步骤，stepNumber 从 1 递增
- instruction 中用 [食材名(克重)] 引用食材，严禁用 [碗N] 引用
- 油、水、调料必须写确切克数，如 [食用油(10g)]、[清水(300g)]
- 每条 cookingStep 的 bowlReferences 固定为空数组 []

JSON Schema：

{
  "summary": {
    "description": "整体菜单描述和搭配思路",
    "cookingOrder": "建议的制作顺序",
    "flavorNotes": "风味特点和搭配说明"
  },
  "dishes": [
    {
      "name": "菜名",
      "ingredients": [
        { "name": "食材名", "estimatedWeight": 克数, "isInInventory": true或false }
      ],
      "seasonings": [
        { "name": "调料名", "amount": "用量描述", "isInInventory": true或false }
      ],
      "estimatedNutrition": { "calories": 大卡, "protein": 克, "fat": 克, "carbs": 克 }
    }
  ],
  "prepSteps": [
    {
      "id": "prep-1",
      "ingredientName": "食材名",
      "quantity": "克数（如200g）",
      "dishName": "所属菜品名",
      "description": "操作描述，用 [食材名(克重)] 引用食材",
      "isCompleted": false,
      "order": 1
    }
  ],
  "cookingSteps": [
    {
      "stepNumber": 1,
      "dishName": "对应菜品名",
      "instruction": "炒制步骤，用 [食材名(克重)] 引用食材，水量写确切克数，油温写确切温度",
      "bowlReferences": [],
      "isCompleted": false
    }
  ],
  "preciseNutrition": [
    { "calories": 大卡, "protein": 克, "fat": 克, "carbs": 克 }
  ],
  "missingItems": [
    { "type": "ingredient或seasoning", "name": "名称", "suggestedAmount": "建议购买量", "forDish": "用于菜品名" }
  ],
  "cookingOrderDescription": "制作顺序简述",
  "flavorDescription": "风味特色简述"
}`;
}

export interface Stage1AIResult {
  dishes: any[];
  missingItems: any[];
  reasoningContent: string;
  summary?: any;
  estimatedNutrition?: any;
  cookingOrderDescription?: string;
  flavorDescription?: string;
  prepSteps?: any[];
  cookingSteps?: any[];
  preciseNutrition?: any[];
}

export async function callAIStage1(
  ingredients: { name: string; weight: number | null; createDate: string }[],
  seasonings: { name: string; status: string }[],
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
  dietaryRestrictions: string[],
  prefs: UserPreferences,
  recentMeals?: string[],
): Promise<Stage1AIResult> {
  const userPrompt = buildStage1UserPrompt(ingredients, seasonings, requirement, dietaryRestrictions, recentMeals);
  const baseUrl = (prefs.apiUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: prefs.modelName || 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CN },
      { role: 'user', content: userPrompt },
    ],
    ...buildThinkingConfig(prefs),
    response_format: { type: 'json_object' },
  };

  const maskedKey = maskApiKey(prefs.apiKey);
  console.log(`[AI Stage1] 调用 API: ${baseUrl}, Key: ${maskedKey}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: buildHeaders(prefs),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : getRetryDelay(attempt);
          console.warn(`[AI Stage1] 429 限流，等待 ${waitMs}ms`);
          await sleep(waitMs);
          continue;
        }
        if (response.status === 400) {
          try {
            delete (body as any).response_format;
            const retryResponse = await fetchWithTimeout(url, {
              method: 'POST',
              headers: buildHeaders(prefs),
              body: JSON.stringify(body),
            });
            const retryData = await retryResponse.json();
            const retryContent = retryData.choices?.[0]?.message?.content;
            const retryReasoning = retryData.choices?.[0]?.message?.reasoning_content || '';
            if (!retryContent) throw new Error('重试后 AI 返回内容为空');
            return { ...JSON.parse(retryContent), reasoningContent: retryReasoning };
          } catch {}
          throw new Error(`请求参数错误（400）`);
        }
        if (response.status === 401) throw new Error('API Key 无效，请在设置中更新');
        if (response.status === 403) throw new Error('访问被拒绝（403），请检查 API Key 权限');
        if (response.status === 404) throw new Error('API 端点不存在（404），请检查 API 地址配置');
        if (response.status >= 500) {
          if (attempt < MAX_RETRIES) {
            await sleep(getRetryDelay(attempt));
            continue;
          }
          throw new Error(`AI 服务器错误（${response.status}）`);
        }
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      const reasoningContent = data.choices?.[0]?.message?.reasoning_content || '';
      if (!content) throw new Error('AI 返回内容为空（JSON Output 模式下偶发，请重试）');
      return { ...JSON.parse(content), reasoningContent };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('AI 请求超时（深度思考可能需要较长时间），是否重试？');
      }
      if (attempt >= MAX_RETRIES) throw error;
      await sleep(getRetryDelay(attempt));
    }
  }
  throw new Error('AI 调用达到最大重试次数');
}

/**
 * Stage1 流式调用
 * 使用 SSE 流式传输，实时接收 AI 思考过程和结果
 */
export function callAIStage1Stream(
  ingredients: { name: string; weight: number | null; createDate: string }[],
  seasonings: { name: string; status: string }[],
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
  dietaryRestrictions: string[],
  prefs: UserPreferences,
  recentMeals: string[] | undefined,
  callbacks: {
    onReasoning: (text: string) => void;
    onContent: (text: string) => void;
    onData?: () => void;
    onDone: (result: Stage1AIResult) => void;
    onError: (error: Error) => void;
  },
): SSEStreamController {
  const userPrompt = buildStage1UserPrompt(ingredients, seasonings, requirement, dietaryRestrictions, recentMeals);
  const baseUrl = (prefs.apiUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: prefs.modelName || 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CN },
      { role: 'user', content: userPrompt },
    ],
    ...buildThinkingConfig(prefs),
    stream: true,
    response_format: { type: 'json_object' },
  };

  const maskedKey = maskApiKey(prefs.apiKey);
  console.log(`[AI Stage1 Stream] 调用 API: ${baseUrl}, Key: ${maskedKey}`);

  log.info(`Stage1 流式调用开始`, {
    personCount: requirement.personCount,
    mealType: requirement.mealType,
    caloriePreference: requirement.caloriePreference,
    ingredientCount: ingredients.length,
    seasoningCount: seasonings.length,
  });
  log.info(`API 配置`, { model: prefs.modelName || 'deepseek-v4-pro', thinkingEnabled: prefs.thinkingEnabled });

  log.time('ai_stage1');

  let chunkCount = 0;
  let firstChunk = true;

  return sseStreamFetch(
    url,
    body as unknown as Record<string, unknown>,
    buildHeaders(prefs),
    {
      onReasoning: callbacks.onReasoning,
      onContent: callbacks.onContent,
      onData: () => {
        chunkCount++;
        if (firstChunk) {
          firstChunk = false;
          log.debug('开始接收数据流', { chunkCount });
        }
        callbacks.onData?.();
      },
      onDone: (fullContent: string, fullReasoning: string, _toolCalls?: any) => {
        log.timeEnd('ai_stage1');
        const reasonTail = fullReasoning?.slice(-100) || '(空)';
        console.log('[AI_STREAM_END] 总chunk:', chunkCount, '| content长度:', fullContent?.length || 0, '| reasoning长度:', fullReasoning?.length || 0);
        console.log('[AI_STREAM_END] reasoning尾100字:', JSON.stringify(reasonTail));
        if (!fullContent || fullContent.trim().length === 0) {
          log.error('AI 流式结束但未生成任何内容（只有思考链）');
          callbacks.onError(new Error('AI 未输出有效内容，请重试或关闭思考模式'));
          return;
        }
        try {
          const result = JSON.parse(fullContent);
          const dishCount = result.dishes?.length || 0;
          log.info(`流式调用完成`, { dishCount, totalChunks: chunkCount });
          console.log('[AI_OUTPUT] dishes:', dishCount, 'prepSteps:', result.prepSteps?.length, 'cookingSteps:', result.cookingSteps?.length, 'preciseNutrition:', result.preciseNutrition?.length);
          if (result.prepSteps?.length) console.log('[AI_OUTPUT] prepSteps sample:', JSON.stringify(result.prepSteps[0]).slice(0, 200));
          if (result.cookingSteps?.length) console.log('[AI_OUTPUT] cookingSteps sample:', JSON.stringify(result.cookingSteps[0]).slice(0, 200));
          callbacks.onDone({
            ...result,
            reasoningContent: fullReasoning,
          });
        } catch {
          log.error('流式返回的 JSON 解析失败');
          console.log('[AI_PARSE_ERROR] fullContent 前300字:', JSON.stringify(fullContent?.slice(0, 300)));
          console.log('[AI_PARSE_ERROR] reasoning尾100字:', JSON.stringify(fullReasoning?.slice(-100)));
          callbacks.onError(new Error('AI 返回格式异常，请检查 API Key 或网络后重试'));
        }
      },
      onError: (error: Error) => {
        log.timeEnd('ai_stage1');
        log.error('流式调用失败', error.message);
        callbacks.onError(error);
      },
    },
    300_000, // 5 分钟超时
  );
}
