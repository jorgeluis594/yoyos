import { Platform, type TextStyle } from 'react-native';

// SDK 57 does not select variable-font weights on native. Use static Inter cuts.
export function interStyle(weight: TextStyle['fontWeight'] = '400'): TextStyle {
  if (Platform.OS === 'web') return { fontFamily: 'Inter', fontWeight: weight };
  const numeric = weight === 'bold' ? 700 : Number(weight);
  const fontFamily = numeric >= 700 ? 'Inter-Bold' : numeric >= 600 ? 'Inter-SemiBold'
    : numeric >= 500 ? 'Inter-Medium' : 'Inter';
  return { fontFamily, fontWeight: 'normal' };
}
