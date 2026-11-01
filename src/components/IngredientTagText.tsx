import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { COLORS, getTagColor, type TagColor } from '../constants/colors';
import { TYPOGRAPHY } from '../constants/typography';
import { parseIngredientTags } from '../utils/ingredientTagParser';

/**
 * 把文本中的 [食材(克重)] 标记渲染为浅底深字的软标签。
 * stage3 备菜描述与 stage5 炒制说明共用。
 *
 * 切分逻辑在 utils/ingredientTagParser.ts —— 旧版本把正则和渲染混在这里，
 * 而那个正则会跨过 `]` 把相邻两个标签并成一个，界面上就会露出半截括号。
 *
 * 颜色优先用调用方传下来的 colorMap（按整份菜单分配，保证同屏不撞色）；
 * 没传就退回按名字散列。
 */
export function IngredientTagText({
  text,
  colorMap,
}: {
  text: string;
  colorMap?: Record<string, TagColor>;
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
        const color = colorMap?.[seg.value] ?? getTagColor(seg.value);
        return (
          <Text
            key={`g${index}`}
            style={[tagStyles.ingredientTag, { backgroundColor: color.bg, color: color.text }]}
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
    fontWeight: '700',
    // 胶囊形状 + 左右留白，让标签和前后文字之间透开一点气
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
    fontSize: 13,
  },
});

export default IngredientTagText;
