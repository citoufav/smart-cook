export const INGREDIENT_TAG_COLORS = [
  '#FF6B35', // 橙色（主色）
  '#2196F3', // 蓝色
  '#2D9F4E', // 绿色
  '#9C27B0', // 紫色
  '#FF9800', // 琥珀
  '#E91E63', // 粉色
  '#00BCD4', // 青色
  '#795548', // 棕色
];

export function getTagColor(index: number): string {
  return INGREDIENT_TAG_COLORS[index % INGREDIENT_TAG_COLORS.length];
}
