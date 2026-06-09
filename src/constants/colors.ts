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
