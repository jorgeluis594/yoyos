import { act, fireEvent, render } from '@testing-library/react-native';
import { ActivityIndicator, StyleSheet } from 'react-native';

import tokens from '../../../../../docs/design-tokens.json';
import { Button, type ButtonProps } from './button';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => mockScheme }));

beforeEach(() => { mockScheme = 'light'; });

const variants: NonNullable<ButtonProps['variant']>[] = ['default', 'secondary', 'ghost', 'destructive'];

test.each(['light', 'dark'] as const)('variants use %s tokens and pressed colors', async (scheme) => {
  jest.useFakeTimers();
  mockScheme = scheme;
  const colors = tokens.colors[scheme];
  const backgrounds = [colors.primary, colors.secondary, 'transparent', colors.destructive];
  const pressedBackgrounds = [colors['primary-pressed'], colors.accent, colors.accent, colors['destructive-pressed']];
  const foregrounds = [colors['primary-foreground'], colors['secondary-foreground'], colors.foreground, colors['destructive-foreground']];

  for (const [index, variant] of variants.entries()) {
    const screen = await render(<Button variant={variant} onPress={() => {}}>{variant}</Button>);
    const button = screen.getByRole('button', { name: variant });
    expect(StyleSheet.flatten(button.props.style).backgroundColor).toBe(backgrounds[index]);
    expect(StyleSheet.flatten(screen.getByText(variant).props.style).color).toBe(foregrounds[index]);
    await fireEvent(button, 'responderGrant', { persist: () => {}, nativeEvent: { pageX: 1, pageY: 1, locationX: 1, locationY: 1 } });
    await act(() => { jest.advanceTimersByTime(200); });
    expect(StyleSheet.flatten(screen.getByRole('button').props.style).backgroundColor).toBe(pressedBackgrounds[index]);
    screen.unmount();
  }
  jest.useRealTimers();
});

test('activates normally and blocks disabled and loading presses', async () => {
  const onPress = jest.fn();
  const screen = await render(<Button onPress={onPress}>Guardar pedido</Button>);
  const button = screen.getByRole('button', { name: 'Guardar pedido' });
  expect(button.props.accessibilityState).toEqual({ disabled: false, busy: false });
  expect(StyleSheet.flatten(button.props.style).minHeight).toBe(48);
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);

  await screen.rerender(<Button disabled onPress={onPress}>Guardar pedido</Button>);
  expect(screen.getByRole('button').props.accessibilityState).toEqual({ disabled: true, busy: false });
  await fireEvent.press(screen.getByRole('button'));
  expect(onPress).toHaveBeenCalledTimes(1);

  await screen.rerender(<Button loading onPress={onPress}>Guardar pedido</Button>);
  expect(screen.getByRole('button').props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(screen.getByText('Guardar pedido')).toBeTruthy();
  expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('shows the focus ring and retains multiline text', async () => {
  const screen = await render(<Button onPress={() => {}}>{'Continuar con una acción larga\nen dos líneas'}</Button>);
  const button = screen.getByRole('button');
  expect(button.props.accessibilityLabel).toContain('en dos líneas');
  await fireEvent(button, 'focus');
  expect(StyleSheet.flatten(screen.getByRole('button').props.style).borderColor).toBe(tokens.colors.light['primary-foreground']);
});
