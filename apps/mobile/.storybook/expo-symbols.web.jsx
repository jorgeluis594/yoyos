import { Text } from 'react-native';

export function SymbolView({ size = 14, style, tintColor }) {
  return <Text accessibilityElementsHidden importantForAccessibility="no" style={[{ color: tintColor, fontSize: size, lineHeight: size }, style]}>›</Text>;
}
