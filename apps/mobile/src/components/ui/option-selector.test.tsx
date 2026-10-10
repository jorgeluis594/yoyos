import i18n from '@mobile/i18n';
import { fireEvent, render } from '@testing-library/react-native';

import { OptionSelector } from './option-selector';
import { Field, FieldError, FieldLabel } from './field';

jest.mock('@expo/ui/community/menu', () => ({
  MenuView: ({ actions, onPressAction, children }: { actions: { id: string; title: string }[]; onPressAction: (event: { nativeEvent: { event: string } }) => void; children: import('react').ReactNode }) => {
    const mockReact = jest.requireActual('react');
    const mockRN = jest.requireActual('react-native');
    return mockReact.createElement(mockReact.Fragment, null, children, ...actions.map(action => mockReact.createElement(
      mockRN.Pressable,
      { key: action.id, accessibilityRole: 'menuitem', accessibilityLabel: action.title, onPress: () => onPressAction({ nativeEvent: { event: action.id } }) },
    )));
  },
}));

const options = [
  { value: 'one', label: 'Uno' },
  { value: 'two', label: 'Dos', description: 'Segunda opción' },
  { value: 'three', label: 'Tres', disabled: true },
  { value: 'four', label: 'Cuatro' },
];

test('shows the current choice, skips disabled options, and changes or clears the value', () => {
  const change = jest.fn();
  const screen = render(<OptionSelector options={options} value="one" onValueChange={change} testID="selector" />);
  expect(screen.getByTestId('selector').props.accessibilityLabel).toBe('Uno');
  expect(screen.queryByRole('menuitem', { name: 'Tres' })).toBeNull();
  fireEvent.press(screen.getByRole('menuitem', { name: 'Dos — Segunda opción' }));
  expect(change).toHaveBeenCalledWith('two');
  screen.rerender(<OptionSelector options={options} value="two" onValueChange={change} testID="selector" />);
  expect(screen.getByTestId('selector').props.accessibilityLabel).toBe('Dos — Segunda opción');
  fireEvent.press(screen.getByRole('menuitem', { name: 'Selecciona una opción' }));
  expect(change).toHaveBeenCalledWith(null);
});

test('connects the field label and error, and disables the menu with the field', () => {
  const screen = render(<Field invalid disabled><FieldLabel>Plan</FieldLabel><OptionSelector options={options} value={null} onValueChange={() => {}} testID="selector" /><FieldError>Elige un plan</FieldError></Field>);
  const selector = screen.getByTestId('selector');
  expect(selector.props.accessibilityLabel).toBe('Plan: Selecciona una opción');
  expect(selector.props.accessibilityHint).toBe('Elige un plan');
  expect(selector.props.accessibilityState.disabled).toBe(true);
  expect(screen.queryByRole('menuitem')).toBeNull();
});

test('default prompt follows the selected language', async () => {
  await i18n.changeLanguage('pt-BR');
  try {
    const selector = render(<OptionSelector options={options} value={null} onValueChange={() => {}} />);
    expect(selector.getByText('Selecione uma opção')).toBeTruthy();
    selector.unmount();
  } finally {
    await i18n.changeLanguage('es');
  }
});
