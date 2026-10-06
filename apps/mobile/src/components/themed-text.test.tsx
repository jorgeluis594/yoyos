import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ThemedText } from '@mobile/components/themed-text';

test('native text uses the actual Inter face for semantic and overridden weights', () => {
  const screen = render(<>
    <ThemedText type="subtitle">Payment</ThemedText>
    <ThemedText style={{ fontWeight: '700' }}>Total</ThemedText>
    <ThemedText type="small">Date</ThemedText>
    <ThemedText style={{ fontFamily: 'monospace' }}>Custom</ThemedText>
  </>);
  expect(StyleSheet.flatten(screen.getByText('Payment').props.style)).toMatchObject({ fontFamily: 'Inter-SemiBold', fontWeight: 'normal' });
  expect(StyleSheet.flatten(screen.getByText('Total').props.style)).toMatchObject({ fontFamily: 'Inter-Bold', fontWeight: 'normal' });
  expect(StyleSheet.flatten(screen.getByText('Date').props.style)).toMatchObject({ fontFamily: 'Inter-Medium', fontWeight: 'normal' });
  expect(StyleSheet.flatten(screen.getByText('Custom').props.style).fontFamily).toBe('monospace');
});
