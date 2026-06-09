import { Ingredient, Seasoning, SeasoningStatus, IngredientSuggestion, SeasoningSuggestion, Stage2AIInput } from '../types';

function normalizeIngredientName(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function findMatchingInventory(normalizedName: string, inventory: Ingredient[]): Ingredient | undefined {
  // 精确匹配
  const exact = inventory.find((i) => normalizeIngredientName(i.name) === normalizedName);
  if (exact) return exact;

  // 包含匹配
  const partial = inventory.find((i) => {
    const invNormal = normalizeIngredientName(i.name);
    return invNormal.includes(normalizedName) || normalizedName.includes(invNormal);
  });
  return partial;
}

export function calculateIngredientSuggestions(
  stage2Input: Stage2AIInput,
  currentInventory: Ingredient[],
): IngredientSuggestion[] {
  const ingredientMap = new Map<string, { usedGrams: number; dishes: Set<string> }>();

  for (const dish of stage2Input.dishes) {
    for (const ing of dish.ingredients) {
      const normalized = normalizeIngredientName(ing.name);
      const existing = ingredientMap.get(normalized);
      if (existing) {
        existing.usedGrams += ing.actualGrams;
        existing.dishes.add(dish.name);
      } else {
        ingredientMap.set(normalized, {
          usedGrams: ing.actualGrams,
          dishes: new Set([dish.name]),
        });
      }
    }
  }

  const suggestions: IngredientSuggestion[] = [];
  for (const [normalizedName, data] of ingredientMap) {
    const match = findMatchingInventory(normalizedName, currentInventory);
    const ingredientId = match ? match.id : `_new_${normalizedName}`;
    const currentStock = match ? match.weight : null;
    const suggestedRemaining = currentStock !== null ? currentStock - data.usedGrams : null;

    suggestions.push({
      ingredientId,
      ingredientName: normalizedName,
      usedGrams: data.usedGrams,
      currentStock,
      suggestedRemaining,
      isSufficient: currentStock !== null ? currentStock >= data.usedGrams : true,
      dishes: [...data.dishes],
    });
  }

  return suggestions;
}

export function calculateSeasoningSuggestions(
  usedSeasoningNames: string[],
  currentSeasonings: Seasoning[],
): SeasoningSuggestion[] {
  return usedSeasoningNames.map((name) => {
    const match = currentSeasonings.find(
      (s) => s.name.trim() === name.trim(),
    );

    if (!match) {
      return {
        seasoningId: `_new_${name}`,
        seasoningName: name,
        currentStatus: 'sufficient' as SeasoningStatus,
        suggestedStatus: null,
        wasUsed: true,
      };
    }

    return {
      seasoningId: match.id,
      seasoningName: match.name,
      currentStatus: match.status,
      suggestedStatus: null,
      wasUsed: true,
    };
  });
}
