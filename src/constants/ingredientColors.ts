export const INGREDIENT_TAG_COLORS = [
  '#FF6B35', // orange (primary)
  '#2196F3', // blue
  '#2D9F4E', // green
  '#9C27B0', // purple
  '#FF9800', // amber
  '#E91E63', // pink
  '#00BCD4', // cyan
  '#795548', // brown
];

export function getTagColor(index: number): string {
  return INGREDIENT_TAG_COLORS[index % INGREDIENT_TAG_COLORS.length];
}
