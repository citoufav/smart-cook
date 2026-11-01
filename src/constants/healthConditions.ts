/**
 * 长期疾病 / 饮食习惯的预设约束。
 *
 * 为什么直接写成"标签：具体做法"的整串存进忌口：AI 读到的就是这一句，
 * 不会被"糖尿病"三个字自由发挥（它可能只是少放点糖，而真正要做的是控总碳水）。
 * 同时它在设置里就是一条普通忌口，能看、能改、能删，不引入新的数据字段。
 *
 * 内容保守：只写公认的做法，不写剂量、不写疗效。**不是医疗建议** ——
 * 界面上一并提示，别让人拿它当营养师。
 */
export interface HealthConditionPreset {
  /** 按钮上显示的字 */
  label: string;
  /** 真正存进忌口、喂给模型的一句话 */
  rule: string;
}

export const HEALTH_CONDITIONS: HealthConditionPreset[] = [
  { label: '糖尿病', rule: '糖尿病：控糖、少精制碳水、低GI' },
  { label: '高血压', rule: '高血压：少盐、少用酱油等高钠调料' },
  { label: '高血脂', rule: '高血脂：少油、少油炸、少肥肉' },
  { label: '痛风', rule: '痛风：少嘌呤，避开动物内脏、浓肉汤和部分海鲜' },
  { label: '胃病', rule: '胃病：不辣、不油炸、少刺激' },
  { label: '孕期', rule: '孕期：食材全熟、少生冷、不放酒' },
  { label: '素食', rule: '素食：不用肉类、禽类、鱼类和海鲜' },
];

/** 这条忌口是不是某个预设已经加进去的（用来点亮按钮） */
export function findConditionByRule(rule: string): HealthConditionPreset | undefined {
  return HEALTH_CONDITIONS.find((c) => c.rule === rule);
}

/**
 * 把选中的情况（存的是**名称**，比如「糖尿病」）展开成给模型看的一句话。
 * 预设的用表里那句写清的规则；自己加的（肾病等）原样带上 —— 用户知道自己该避什么，
 * 我们能做的是别把它塞进「忌口：不吃X」那种句式里让它变形。
 */
export function formatHealthRules(labels: string[]): string {
  return labels
    .map((label) => HEALTH_CONDITIONS.find((c) => c.label === label)?.rule ?? label)
    .join('；');
}
