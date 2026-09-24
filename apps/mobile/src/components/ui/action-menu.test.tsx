import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import tokens from '../../../../../docs/design-tokens.json';

import { ActionMenu } from './action-menu';

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@expo/ui/community/menu', () => ({
  MenuView: ({ actions, onPressAction, children }: { actions: { id: string; title: string; attributes?: { destructive?: boolean } }[]; onPressAction: (event: { nativeEvent: { event: string } }) => void; children: import('react').ReactNode }) => {
    const mockReact = jest.requireActual('react');
    const mockRN = jest.requireActual('react-native');
    return mockReact.createElement(mockReact.Fragment, null, children, ...actions.map((action) => mockReact.createElement(
      mockRN.Pressable,
      { key: action.id, accessibilityRole: 'button', accessibilityLabel: action.title, onPress: () => onPressAction({ nativeEvent: { event: action.id } }) },
      mockReact.createElement(mockRN.Text, null, `${action.title}${action.attributes?.destructive ? ':destructive' : ''}`),
    )));
  },
}));

test('maps action labels and destructive state, then dispatches selection by id', async () => {
  const onEdit = jest.fn();
  const onDelete = jest.fn();
  const screen = await render(<ActionMenu actions={[
    { id: 'edit', label: 'Editar', onSelect: onEdit },
    { id: 'delete', label: 'Eliminar', destructive: true, onSelect: onDelete },
  ]} />);

  const trigger = screen.getByRole('button', { name: 'Más acciones' });
  expect(StyleSheet.flatten(trigger.props.style).minWidth).toBe(tokens.sizing.touchTargetMinSize);
  expect(StyleSheet.flatten(trigger.props.style).minHeight).toBe(tokens.sizing.touchTargetMinSize);
  await fireEvent.press(screen.getByRole('button', { name: 'Editar' }));
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onDelete).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Eliminar' }));
  expect(screen.getByText('Eliminar:destructive')).toBeTruthy();
  expect(onDelete).toHaveBeenCalledTimes(1);
});
