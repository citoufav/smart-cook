import { CHINESE_NUMBER_MAP, CIRCLE_NUMBER_MAP } from '../constants/cooking';
import { BowlAssignment, CookingStep, BowlValidationResult, BowlValidationError } from '../types';

export function extractBowlNumbers(text: string): number[] {
  const numbers: number[] = [];

  // 中文圆圈数字 ①-⑩
  for (const [char, num] of Object.entries(CIRCLE_NUMBER_MAP)) {
    if (text.includes(char)) numbers.push(num);
  }

  // 中文数字 碗一 ~ 碗十
  const chineseRegex = /碗([一二三四五六七八九十])/g;
  let match: RegExpExecArray | null;
  while ((match = chineseRegex.exec(text)) !== null) {
    const num = CHINESE_NUMBER_MAP[match[1]];
    if (num !== undefined) numbers.push(num);
  }

  // 阿拉伯数字 碗1 ~ 碗99
  const arabicRegex = /碗(\d+)/g;
  while ((match = arabicRegex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    if (num > 0 && num <= 100) numbers.push(num);
  }

  // 英文 bowl 1 etc
  const englishRegex = /bowl\s*(\d+)/gi;
  while ((match = englishRegex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    if (num > 0 && num <= 100) numbers.push(num);
  }

  return [...new Set(numbers)].sort((a, b) => a - b);
}

function findNearestBowlNumber(targetNumber: number, existingNumbers: number[]): number | null {
  if (existingNumbers.length === 0) return null;
  return existingNumbers.reduce((prev, curr) =>
    Math.abs(curr - targetNumber) < Math.abs(prev - targetNumber) ? curr : prev,
  );
}

export function validateBowlReferences(
  bowlAssignments: BowlAssignment[],
  cookingSteps: CookingStep[],
): BowlValidationResult {
  const safeBowls: BowlAssignment[] = Array.isArray(bowlAssignments) ? bowlAssignments : [];
  const safeSteps: CookingStep[] = Array.isArray(cookingSteps) ? cookingSteps : [];

  const errors: BowlValidationError[] = [];
  const assignedBowlNumbers = new Set(safeBowls.map((b) => b.bowlNumber));

  // 检查 cookingSteps 中引用的碗编号
  const referencedBowlNumbers = new Set<number>();
  for (const step of safeSteps) {
    for (const ref of step.bowlReferences) {
      referencedBowlNumbers.add(ref);
      if (!assignedBowlNumbers.has(ref)) {
        const nearest = findNearestBowlNumber(ref, [...assignedBowlNumbers]);
        errors.push({
          type: 'missing_bowl',
          bowlNumber: ref,
          severity: 'error',
          message: nearest
            ? `炒制步骤引用了不存在的碗${ref}（最近的碗编号为${nearest}）`
            : `炒制步骤引用了不存在的碗${ref}`,
        });
      }
    }
  }

  // 检查未引用的碗
  for (const bowlNumber of assignedBowlNumbers) {
    if (!referencedBowlNumbers.has(bowlNumber)) {
      errors.push({
        type: 'unreferenced_bowl',
        bowlNumber,
        severity: 'warning',
        message: `碗${bowlNumber}未被任何炒制步骤引用`,
      });
    }
  }

  const errorCount = errors.filter((e) => e.severity === 'error').length;
  const warningCount = errors.filter((e) => e.severity === 'warning').length;

  return {
    isValid: errorCount === 0,
    errors,
    summary: { errorCount, warningCount },
  };
}
