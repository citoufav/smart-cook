import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { COLORS, getTagColor } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { IngredientTag } from '../types';
import { parseIngredientTags } from '../utils/ingredientTagParser';

/**
 * 把文本中的 [食材(克重)] 标记渲染为实色标签。
 * stage3 备菜描述与 stage5 炒制说明共用。
 *
 * 切分逻辑在 utils/ingredientTagParser.ts —— 旧版本把正则和渲染混在这里，
 * 而那个正则会跨过 `]` 把相邻两个标签并成一个，界面上就会露出半截括号。
 */
export function IngredientTagText({
  text,
  ingredientTags,
}: {
  text: string;
  ingredientTags?: IngredientTag[];
}) {
  const segments = parseIngredientTags(text);

  return (
    <Text>
      {segments.map((seg, index) => {
        if (seg.kind === 'text') {
          return (
            <Text key={`t${index}`} style={tagStyles.plainText}>{seg.value}</Text>
          );
        }
        const tagColor = ingredientTags?.find((t) => t.name === seg.value)?.color || getTagColor(seg.value);
        return (
          <Text
            key={`g${index}`}
            style={[tagStyles.ingredientTag, { backgroundColor: tagColor }]}
          >
            {seg.value}({seg.amount})
          </Text>
        );
      })}
    </Text>
  );
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
