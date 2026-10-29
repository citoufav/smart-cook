import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { IngredientTag } from '../types';

/**
 * 解析文本中的 [食材(克重)] / [食材(非克重描述)] 标记，渲染为实色标签。
 * stage3 备菜描述与 stage5 炒制说明共用（原为两处重复实现）。
 */
export function IngredientTagText({
  text,
  ingredientTags,
}: {
  text: string;
  ingredientTags?: IngredientTag[];
}) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  // Two branches: ingredient(grams) | ingredient(non-gram description)
  const regex = /\[(.+?)\((\d+)g\)\]|\[(.+?)\((\S+?)\)\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`t${lastIndex}`} style={tagStyles.plainText}>{text.slice(lastIndex, match.index)}</Text>,
      );
    }
    if (match[3]) {
      // Non-gram tag: [ingredient(a pinch / to taste / X spoonfuls)]
      const tagName = match[3];
      const tagDesc = match[4];
      const tagColor = ingredientTags?.find((t) => t.name === tagName)?.color || COLORS.primary;
      parts.push(
        <Text
          key={match.index}
          style={[tagStyles.ingredientTag, { backgroundColor: tagColor }]}
        >
          {tagName}({tagDesc})
        </Text>,
      );
    } else {
      // Gram tag: [ingredient(numeric grams)]
      const tagName = match[1];
      const tagWeight = match[2];
      const tagColor = ingredientTags?.find((t) => t.name === tagName)?.color || COLORS.primary;
      parts.push(
        <Text
          key={match.index}
          style={[tagStyles.ingredientTag, { backgroundColor: tagColor }]}
        >
          {tagName}({tagWeight}g)
        </Text>,
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<Text key={`t${lastIndex}`} style={tagStyles.plainText}>{text.slice(lastIndex)}</Text>);
  }

  return <Text>{parts}</Text>;
}

const tagStyles = StyleSheet.create({
  plainText: {
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    lineHeight: 22,
  },
  ingredientTag: {
    color: '#FFFFFF',
    fontWeight: '600',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
    fontSize: 13,
  },
});

export default IngredientTagText;
