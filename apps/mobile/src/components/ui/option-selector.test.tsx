import { fireEvent, render } from '@testing-library/react-native';
import { View } from 'react-native';

import { OptionSelector } from './option-selector';
import { Field, FieldError, FieldLabel } from './field';

jest.mock('@expo/ui', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  const Item = () => null;
  const Picker = ({ children, selectedValue, onValueChange, testID }: any) => (
    <View testID={testID} accessibilityRole="adjustable" accessibilityValue={{ text: String(selectedValue) }} onTouchEnd={() => onValueChange(0)}>
      {React.Children.map(children, (child: any) => child.type === Item ? <Text>{child.props.label}</Text> : null)}
    </View>
  );
  Picker.Item = Item;
  return { Host: ({ children }: any) => <View>{children}</View>, Picker };
});

const options = [
  { value: 'one', label: 'Uno' },
  { value: 'two', label: 'Dos', description: 'Segunda opción' },
  { value: 'three', label: 'Tres', disabled: true },
  { value: 'four', label: 'Cuatro' },
];

test('four options render radio rows, report selection, and reflect the controlled value', async () => {
  const change = jest.fn();
  const screen = await render(<OptionSelector options={options} value="one" onValueChange={change} />);
  expect(screen.getAllByRole('radio')).toHaveLength(4);
  expect(screen.getByRole('radio', { name: 'Uno' }).props.accessibilityState.checked).toBe(true);
  expect(screen.getByRole('radio', { name: 'Tres' }).props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByRole('radio', { name: 'Dos' }));
  expect(change).toHaveBeenCalledWith('two');
  await screen.rerender(<OptionSelector options={options} value="two" onValueChange={change} />);
  expect(screen.getByRole('radio', { name: 'Dos' }).props.accessibilityState.checked).toBe(true);
});

test('five options use the native picker with a null placeholder', async () => {
  const screen = await render(<OptionSelector options={[...options, { value: 'five', label: 'Cinco' }]} value={null} onValueChange={() => {}} testID="picker" />);
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.getByTestId('picker').props.accessibilityValue.text).toBe('-1');
  expect(screen.getByText('Selecciona una opción')).toBeTruthy();
  expect(screen.queryByText('Tres')).toBeNull();
});

test('field label and error are connected to the selector', async () => {
  const screen = await render(<Field invalid><FieldLabel>Plan</FieldLabel><OptionSelector options={options.slice(0, 2)} value={null} onValueChange={() => {}} /><FieldError>Elige un plan</FieldError></Field>);
  const selector = screen.UNSAFE_getByType(View);
  const group = selector.findAll((node) => node.props.accessibilityRole === 'radiogroup')[0];
  expect(group.props.accessibilityLabel).toBe('Plan');
  expect(group.props.accessibilityHint).toBe('Elige un plan');
  expect(screen.getByText('Elige un plan')).toBeTruthy();
});
