export const COLORS = {
  primary: '#FF6B35',
  primaryLight: '#FF8C5A',
  primaryDark: '#E55A2B',
  primaryBg: '#FFF0E6',
  
  textPrimary: '#1A1A1A',
  textBody: '#495057',
  textSecondary: '#6C757D',
  textTertiary: '#ADB5BD',
  textWhite: '#FFFFFF',
  
  background: '#FAFAFA',
  surface: '#FFFFFF',
  border: '#E8E8E8',
  borderLight: '#F0F0F0',
  
  success: '#2D9F4E',
  successLight: '#D4EDDA',
  successText: '#155724',
  warning: '#FFC107',
  warningLight: '#FFF3CD',
  warningText: '#856404',
  danger: '#D32F2F',
  dangerLight: '#F8D7DA',
  dangerText: '#721C24',
  info: '#2196F3',
  infoLight: '#E3F2FD',
  infoText: '#0D47A1',
  
  neutral: '#9E9E9E',
  neutralLight: '#F5F5F5',
  
  overlay: 'rgba(0,0,0,0.5)',
  shadow: 'rgba(0,0,0,0.1)',
} as const;

export const SEASONING_STATUS_LABEL: Record<string, string> = {
  sufficient: '充足',
  low: '少量',
  out: '缺少',
};

export const SEASONING_STATUS_COLORS = {
  sufficient: { bg: '#D4EDDA', text: '#155724' },
  low: { bg: '#FFF3CD', text: '#856404' },
  out: { bg: '#F8D7DA', text: '#721C24' },
} as const;

/**
 * 食材标签配色。按名字散列取色，同一食材在任何菜、任何菜单里都是同一个颜色。
 *
 * 刻意不用 AI 返回的颜色：模型编出来的十六进制值跨次生成不稳定，
 * 还容易给出对比度不足的浅色（标签里是白字）。这里全取深色系，保证白字可读。
 */
export const TAG_COLORS = [
  '#1976D2', // 蓝
  '#388E3C', // 绿
  '#7B1FA2', // 紫
  '#C2185B', // 玫红
  '#E64A19', // 橙红
  '#00796B', // 青绿
  '#5D4037', // 棕
  '#455A64', // 蓝灰
] as const;

export function getTagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
}
