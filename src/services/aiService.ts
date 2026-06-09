import { UserPreferences, Stage2AIInput, Stage2AIResponse, GeneratedPlan, IngredientTag } from '../types';
import { DEFAULT_TIMEOUT_MS, MAX_RETRIES, BASE_RETRY_DELAY_MS, MAX_PATCH_ATTEMPTS } from '../constants/cooking';
import { extractBowlNumbers, validateBowlReferences } from '../utils/bowlValidation';
import { sseStreamFetch, SSECallbacks, SSEStreamController } from '../utils/sseStream';
import { INGREDIENT_TAG_COLORS } from '../constants/ingredientColors';

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
3. 统一单位：所有食材重量单位为"克"（g），调料用"适量/少许/X勺"等描述。
4. 严格 JSON：只返回纯 JSON，禁止用 \`\`\`json\`\`\` 包裹，禁止输出任何非 JSON 文本。
5. 全局一致性：生成前先通盘考虑备菜→分装→炒制全流程，确保步骤衔接无矛盾。
6. 主食=菜品：米饭、馒头、面条、花卷、烙饼等主食与炒菜一样是独立菜品，必须包含在 dishes 中，有独立的 estimatedNutrition。

【营养与搭配】
7. 成年男性 600-800 大卡/餐，成年女性 500-600 大卡/餐。
8. 早餐 300-500 大卡，20 分钟内可完成。
9. 午餐/晚餐根据人数和热量目标合理搭配，荤素搭配，有主食。
10. 中餐为主，1人份主料 150-300g。

【备菜步骤 — 重要】
11. 相同食材、相同切配方式 → 必须合并为一个备菜步骤。
    ✅ 正确：小葱共10g，切葱花。description: "取[小葱(10g)]洗净，切成葱花"
    ❌ 错误：小葱切葱花（紫菜蛋花汤）+ 小葱切葱花（凉拌西兰花）写成两个步骤
    合并后在 bowlAssignments 中再按菜品分配（见下方规则）。
12. prepSteps 格式：每条包含 ingredientName(食材名)、quantity(用量如200g)、description(操作描述)。
    description 中用 [食材名(克重)] 引用食材。
    ✅ 正确："淘洗[大米(200g)]，换水浸泡20分钟后沥干"
    ❌ 错误：提及碗编号、写入碗1/碗2，或写比例"水米1:1.2"

【分装步骤 — 重要】
13. 合并备菜的处理：同一食材合并切配后，在 bowlAssignments 中按菜品实际用量分开分配。
    示例：小葱10g切葱花合并 → 碗3 contents: "小葱葱花5g" → 碗5 contents: "小葱葱花5g"
14. bowlAssignments 按菜品分组，每道菜的食材/调料分配到一个或多个碗，碗编号从1开始递增。
15. contents 字段列出碗内具体内容（如"大米200g + 火腿丁50g + 玉米粒30g"）。

【炒制步骤 — 重要】
16. 新手友好：每一步操作写明确切的克数、温度和时间。
    ✅ 正确："锅中加入[食用油(10g)]，烧至六成热（约160°C），放入[蒜末(5g)]爆香..."
    ❌ 错误："水米比例1:1.2"、"油温适中"、"适量加水"、"焖至熟"
    煮米饭等需要加水的操作：必须写确切水量，如"加入清水300g，大火煮沸后转小火焖15分钟"
17. cookingSteps.instruction 中用 [碗N] 引用碗，用 [食材名(克重)] 引用食材。
    示例："将[碗1]倒入锅中，加入[清水(300g)]，大火煮沸"

【其他规则】
18. 调料必须给出克重数字：油类、酱油、醋、料酒、盐、糖、淀粉等一律用 [调料名(Xg)] 格式，禁止"适量/少许/X勺"。只有粉状调料（花椒粉、胡椒粉、十三香等）可用1-5g范围。
19. 食材不足时 dishes 数组不能为空，至少给出 1 道利用现有食材的简易菜（蛋炒饭、拌面、炒时蔬等）。
20. 所有输出使用中文。
21. **标签格式严格要求**：[食材名(克重)] 和 [碗N] 标签的方括号必须完整闭合，不允许出现 碗1] 或 [清水(120g 等断括号。油类（食用油、香油等）必须给出克重数字。`;

function buildStage1UserPrompt(
  ingredients: { name: string; weight: number | null; createDate: string }[],
  seasonings: { name: string; status: string }[],
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
  dietaryRestrictions: string[],
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
    ? `热量目标：每道菜合计约${requirement.caloriePreference}大卡`
    : `热量目标：不限，请根据${requirement.personCount}人份的营养指南合理搭配`;

  const customText = requirement.customRequirement ? `特殊需求：${requirement.customRequirement}` : '';
  const restrictionText = dietaryRestrictions.length > 0 ? `忌口：${dietaryRestrictions.join(', ')}` : '';

  return `【基本信息】
用餐人数：${requirement.personCount}人
餐类：${requirement.mealType}
${calorieText}
${customText}
${restrictionText}

【库存食材】
${ingredientLines}

【库存调料】
${seasoningLines}

请严格按照以下 JSON Schema 返回，确保 dishes 数组至少包含 1 道菜品：

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
}

export async function callAIStage1(
  ingredients: { name: string; weight: number | null; createDate: string }[],
  seasonings: { name: string; status: string }[],
  requirement: { personCount: number; mealType: string; caloriePreference?: number; customRequirement: string },
  dietaryRestrictions: string[],
  prefs: UserPreferences,
): Promise<Stage1AIResult> {
  const userPrompt = buildStage1UserPrompt(ingredients, seasonings, requirement, dietaryRestrictions);
  const baseUrl = (prefs.apiUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: prefs.modelName || 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CN },
      { role: 'user', content: userPrompt },
    ],
    ...buildThinkingConfig(prefs),
    max_tokens: 8192,
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
  callbacks: {
    onReasoning: (text: string) => void;
    onContent: (text: string) => void;
    onData?: () => void;
    onDone: (result: Stage1AIResult) => void;
    onError: (error: Error) => void;
  },
): SSEStreamController {
  const userPrompt = buildStage1UserPrompt(ingredients, seasonings, requirement, dietaryRestrictions);
  const baseUrl = (prefs.apiUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: prefs.modelName || 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CN },
      { role: 'user', content: userPrompt },
    ],
    ...buildThinkingConfig(prefs),
    max_tokens: 8192,
    stream: true,
    response_format: { type: 'json_object' },
  };

  const maskedKey = maskApiKey(prefs.apiKey);
  console.log(`[AI Stage1 Stream] 调用 API: ${baseUrl}, Key: ${maskedKey}`);

  return sseStreamFetch(
    url,
    body as unknown as Record<string, unknown>,
    buildHeaders(prefs),
    {
      onReasoning: callbacks.onReasoning,
      onContent: callbacks.onContent,
      onData: callbacks.onData,
      onDone: (fullContent: string, fullReasoning: string) => {
        try {
          // 流式返回的 content 在 JSON Output 模式下可能是不完整的，
          // 先尝试直接解析，失败则等待 onloadend 确保完整性
          const result = JSON.parse(fullContent);
          callbacks.onDone({
            ...result,
            reasoningContent: fullReasoning,
          });
        } catch {
          // 如果 JSON 解析失败（流式传输可能截断），抛出错误
          callbacks.onError(new Error('AI 返回的 JSON 格式有误，请重试'));
        }
      },
      onError: callbacks.onError,
    },
    300_000, // 5 分钟超时
  );
}

/** 从称量后的 Stage2AIInput 生成食材标签列表 */
export function buildIngredientTags(input: Stage2AIInput): IngredientTag[] {
  const tagMap = new Map<string, number>();

  for (const dish of input.dishes) {
    for (const ing of dish.ingredients) {
      const existing = tagMap.get(ing.name);
      if (existing !== undefined) {
        tagMap.set(ing.name, existing + ing.actualGrams);
      } else {
        tagMap.set(ing.name, ing.actualGrams);
      }
    }
  }

  let index = 0;
  return [...tagMap.entries()].map(([name, weight]) => ({
    name,
    weight,
    color: INGREDIENT_TAG_COLORS[index++ % INGREDIENT_TAG_COLORS.length],
  }));
}

function buildStage2UserPrompt(input: Stage2AIInput): string {
  const dishLines = input.dishes.map((d, i) => {
    const ingLines = d.ingredients.map((ing) => `    - ${ing.name}：${ing.actualGrams}克`).join('\n');
    return `${i + 1}. ${d.name}\n${ingLines}`;
  }).join('\n\n');

  const seasoningText = input.availableSeasonings.length > 0
    ? input.availableSeasonings.join('、')
    : '无特别指定，请根据菜品需要自行搭配';

  const calorieText = input.calorieTarget
    ? `热量目标：总计约${input.calorieTarget}大卡`
    : '热量目标：不限，合理搭配即可';

  const tags = buildIngredientTags(input);
  const tagLines = tags.length > 0
    ? tags.map((t) => `- ${t.name}：${t.weight}g`).join('\n')
    : '无';

  return `【确认后的菜品与食材】
${dishLines}

【可用调料】
${seasoningText}

【基本信息】
用餐人数：${input.peopleCount}人
餐类：${input.mealType}
${calorieText}

【可用食材标签（在步骤中用 [食材名(克重)] 格式引用）】
${tagLines}

【重要：备菜合并规则】
如果同一食材在多道菜品中的切配方式完全相同，必须合并为一个备菜步骤，在分装阶段再分开。
示例：
  菜品：紫菜蛋花汤（用5g小葱）、凉拌西兰花（用5g小葱）→ 食材标签 [小葱(10g)]
  合并备菜：prep-1, ingredientName: "小葱", quantity: "10g", description: "取[小葱(10g)]洗净，切成葱花"
  分装分配：
    碗3: dishName: "紫菜蛋花汤", contents: "小葱葱花5g", ingredients: ["小葱"]
    碗5: dishName: "凉拌西兰花", contents: "小葱葱花5g", ingredients: ["小葱"]
如果切配方式不同（如一道切片一道切丝），则分开列出。

【炒制步骤详细度要求】
新手友好：所有需要加水/加油的操作必须写确切克数。
  煮米饭示例："将[碗1]放入电饭煲，加入[清水(300g)]（没过米面约1cm），启动煮饭模式"
  炒菜示例："锅中加入[食用油(10g)]，烧至六成热（约160°C），放入[碗2]翻炒2分钟至变色"

请严格按照以下 JSON Schema 返回纯 JSON（不要用 \`\`\`json 包裹）：

{
  "prepSteps": [
    {
      "id": "prep-1",
      "ingredientName": "食材名",
      "quantity": "克数（如200g，合并时写总量）",
      "description": "操作描述，用 [食材名(克重)] 引用食材，严禁提碗编号",
      "isCompleted": false,
      "order": 1
    }
  ],
  "bowlAssignments": [
    {
      "bowlNumber": 1,
      "dishName": "对应菜品名",
      "contents": "碗内具体内容（如 '大米200g + 火腿丁50g'）",
      "ingredients": ["食材名1", "食材名2"],
      "isCompleted": false
    }
  ],
  "cookingSteps": [
    {
      "stepNumber": 1,
      "dishName": "对应菜品名",
      "instruction": "炒制步骤，碗用 [碗N]，食材用 [食材名(克重)]，水量写确切克数",
      "bowlReferences": [1, 2],
      "isCompleted": false
    }
  ],
  "preciseNutrition": [
    { "calories": 大卡, "protein": 克, "fat": 克, "carbs": 克 }
  ]
}

必须遵守的规则（违反将导致方案不可用）：
1. prepSteps 覆盖所有需切/洗/腌制的食材，相同切配方式必须合并
2. prepSteps.description 用 [食材名(克重)] 引用食材，绝对禁止写碗编号
3. bowlAssignments 碗编号从1连续递增，合并备菜时按菜品实际用量拆分
4. bowlAssignments.contents 列出碗内所有内容，不含水量（水量在炒制步骤中写）
5. cookingSteps.bowlReferences 必须引用 bowlAssignments 中实际存在的 bowlNumber
6. cookingSteps.instruction 用 [碗N] 引用碗，用 [食材名(克重)] 引用食材，水量写确切克数
7. preciseNutrition 长度与菜品数一致，基于实际称量克重计算
8. 所有克数为精确数字，调料必须给克重：油类、酱油、醋、料酒、盐、糖等一律用 [调料名(Xg)] 格式，禁止"适量/少许/X勺"，粉状调料可用1-5g
9. 所有 [食材名(克重)] 和 [碗N] 标签方括号必须完整闭合，不允 碗1] 或 [清水(120g 等断括号
10. 油类（食用油、香油等）已是称量过的食材，必须给克重数字，如 [食用油(10g)]`;
}

export async function callAIStage2(
  input: Stage2AIInput,
  prefs: UserPreferences,
): Promise<Stage2AIResponse> {
  const baseUrl = (prefs.apiUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const userPrompt = buildStage2UserPrompt(input);

  const body = {
    model: prefs.modelName || 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CN + '\n请生成备菜步骤、分装碗分配、炒制步骤，所有碗编号必须一致。' },
      { role: 'user', content: userPrompt },
    ],
    ...buildThinkingConfig(prefs),
    max_tokens: 32768,
    response_format: { type: 'json_object' },
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: buildHeaders(prefs),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          await sleep(getRetryDelay(attempt));
          continue;
        }
        throw new Error(`AI 调用失败: ${response.status}`);
      }
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('AI Stage2 返回内容为空，请重试');
      return JSON.parse(content) as Stage2AIResponse;
    } catch (error: any) {
      if (attempt >= MAX_RETRIES) throw error;
      await sleep(getRetryDelay(attempt));
    }
  }
  throw new Error('AI Stage2 调用失败');
}

/**
 * Stage2 流式调用
 * 使用 SSE 流式传输，实时接收 AI 思考过程和生成的方案
 */
export function callAIStage2Stream(
  input: Stage2AIInput,
  prefs: UserPreferences,
  callbacks: {
    onReasoning: (text: string) => void;
    onContent: (text: string) => void;
    onData?: () => void;
    onDone: (result: Stage2AIResponse, reasoningContent: string) => void;
    onError: (error: Error) => void;
  },
): SSEStreamController {
  const baseUrl = (prefs.apiUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const userPrompt = buildStage2UserPrompt(input);

  const body = {
    model: prefs.modelName || 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CN + '\n请生成备菜步骤、分装碗分配、炒制步骤，所有碗编号必须一致。' },
      { role: 'user', content: userPrompt },
    ],
    ...buildThinkingConfig(prefs),
    max_tokens: 32768,
    stream: true,
    response_format: { type: 'json_object' },
  };

  return sseStreamFetch(
    url,
    body as unknown as Record<string, unknown>,
    buildHeaders(prefs),
    {
      onReasoning: callbacks.onReasoning,
      onContent: callbacks.onContent,
      onData: callbacks.onData,
      onDone: (fullContent: string, fullReasoning: string) => {
        try {
          const result = JSON.parse(fullContent) as Stage2AIResponse;
          callbacks.onDone(result, fullReasoning);
        } catch {
          callbacks.onError(new Error('AI 返回的 JSON 格式有误，请重试'));
        }
      },
      onError: callbacks.onError,
    },
    300_000,
  );
}

export async function callAIPatch(
  currentResponse: Stage2AIResponse,
  errors: any[],
  prefs: UserPreferences,
): Promise<Stage2AIResponse> {
  const baseUrl = (prefs.apiUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const errorDescriptions = errors.map((e: any) => `- [${e.type}]: ${e.message}`).join('\n');

  const patchPrompt = `以下方案存在碗编号不一致问题，请修正：

当前方案：
${JSON.stringify(currentResponse, null, 2)}

不一致问题：
${errorDescriptions}

约束：
- 只能调整调料配比和碗编号引用
- 不要改动食材称量数据和备菜步骤
- 确保所有碗编号引用都指向实际存在的碗

返回修正后的完整 JSON，保持结构不变。`;

  const body = {
    model: prefs.modelName || 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: '你是方案修正助手，只修复碗编号一致性问题。' },
      { role: 'user', content: patchPrompt },
    ],
    ...buildThinkingConfig(prefs),
    max_tokens: 16384,
    response_format: { type: 'json_object' },
  };

  for (let attempt = 1; attempt <= MAX_PATCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: buildHeaders(prefs),
        body: JSON.stringify(body),
      });
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('AI Patch 返回内容为空，请重试');
      return JSON.parse(content) as Stage2AIResponse;
    } catch (error: any) {
      if (attempt >= MAX_PATCH_ATTEMPTS) throw error;
      await sleep(getRetryDelay(attempt));
    }
  }
  throw new Error('修补达到最大尝试次数');
}

export async function generateAndValidatePlan(
  input: Stage2AIInput,
  prefs: UserPreferences,
): Promise<{ response: Stage2AIResponse; validationResult: any; repairAttempts: number }> {
  let response = await callAIStage2(input, prefs);
  let validationResult = validateBowlReferences(response.bowlAssignments, response.cookingSteps);
  let repairAttempts = 0;

  while (!validationResult.isValid && repairAttempts < MAX_PATCH_ATTEMPTS) {
    repairAttempts++;
    await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, repairAttempts - 1));

    const errorOnly = validationResult.errors.filter((e: any) => e.severity === 'error');
    if (errorOnly.length > 0) {
      try {
        response = await callAIPatch(response, errorOnly, prefs);
        validationResult = validateBowlReferences(response.bowlAssignments, response.cookingSteps);
      } catch {
        break;
      }
    } else {
      break;
    }
  }

  return { response, validationResult, repairAttempts };
}
