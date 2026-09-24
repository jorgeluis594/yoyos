import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import tokens from '../../../../../docs/design-tokens.json';
import { ListRow } from './list-row';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => mockScheme }));

beforeEach(() => { mockScheme = 'light'; });

test('uses the minimum row height, activates on press, and lets trailing replace the chevron', async () => {
  const onPress = jest.fn();
  const screen = await render(<ListRow title="Pedido #1042" description="3 productos" onPress={onPress} />);
  const row = screen.getByRole('button');
  expect(row).toHaveAccessibleName(/Pedido #1042.*3 productos/);
  expect(StyleSheet.flatten(row.props.style).minHeight).toBe(tokens.sizing.listRowMobileMinHeight);
  expect(screen.UNSAFE_getAllByType(Text).some((node) => node.props.children === '›')).toBe(true);
  expect(screen.getByText('3 productos')).toBeTruthy();
  await fireEvent.press(row);
  expect(onPress).toHaveBeenCalledTimes(1);

  await screen.rerender(<ListRow title="Pedido #1042" trailing={<Text>S/ 128.00</Text>} onPress={onPress} />);
  expect(screen.getByRole('button')).toHaveAccessibleName(/Pedido #1042.*S\/ 128\.00/);
  expect(screen.getByText('S/ 128.00')).toBeTruthy();
  expect(screen.UNSAFE_getAllByType(Text).some((node) => node.props.children === '›')).toBe(false);
});
