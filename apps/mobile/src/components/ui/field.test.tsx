import { fireEvent, render } from '@testing-library/react-native';
import { createRef } from 'react';
import { TextInput } from 'react-native';

import tokens from '../../../../../docs/design-tokens.json';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './field';
import { Input } from './input';
import { Textarea } from './textarea';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => mockScheme }));

beforeEach(() => { mockScheme = 'light'; });

test('composes a controlled field with label, help, error and required state', async () => {
  const change = jest.fn();
  const blur = jest.fn();
  const ref = createRef<TextInput>();
  const screen = await render(
    <FieldGroup>
      <Field required invalid>
        <FieldLabel>Nombre</FieldLabel>
        <Input ref={ref} value="Ana" onChangeText={change} onBlur={blur} testID="name" />
        <FieldDescription>Nombre para el cliente</FieldDescription>
        <FieldError>Ingresa el nombre</FieldError>
      </Field>
    </FieldGroup>,
  );
  const input = screen.getByTestId('name');
  expect(input.props.accessibilityLabel).toBe('Nombre *');
  expect(input.props.accessibilityLabelledBy).toBe(screen.getByText('Nombre *').props.nativeID);
  expect(input.props.accessibilityHint).toContain('Nombre para el cliente');
  expect(input.props.accessibilityHint).toContain('Ingresa el nombre');
  expect(input.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ borderColor: tokens.colors.light.error })]));
  expect(input.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ fontFamily: tokens.typography.family })]));
  await fireEvent.changeText(input, 'Ana María');
  await fireEvent(input, 'blur');
  expect(change).toHaveBeenCalledWith('Ana María');
  expect(blur).toHaveBeenCalledTimes(1);
  expect(ref.current).toBeTruthy();
});

test('Field states take precedence over control states', async () => {
  const screen = await render(
    <Field disabled={false} invalid={false}>
      <FieldLabel>Correo</FieldLabel>
      <Input value="" onChangeText={() => {}} disabled invalid testID="email" />
      <FieldDescription>Usa tu correo laboral</FieldDescription>
      <FieldError>Incorrecto</FieldError>
    </Field>,
  );
  let input = screen.getByTestId('email');
  expect(input.props.editable).toBe(true);
  expect(input.props.accessibilityHint).toBe('Usa tu correo laboral');
  await screen.rerender(
    <Field disabled invalid>
      <FieldLabel>Correo</FieldLabel>
      <Input value="" onChangeText={() => {}} disabled={false} invalid={false} testID="email" />
      <FieldDescription>Usa tu correo laboral</FieldDescription>
      <FieldError>Incorrecto</FieldError>
    </Field>,
  );
  input = screen.getByTestId('email');
  expect(input.props.editable).toBe(false);
  expect(input.props.accessibilityState.disabled).toBe(true);
  expect(input.props.accessibilityHint).toContain('Incorrecto');
  await screen.rerender(
    <Field invalid>
      <FieldLabel>Correo</FieldLabel>
      <Input value="" onChangeText={() => {}} testID="email" />
      <FieldDescription>Usa tu correo laboral</FieldDescription>
    </Field>,
  );
  expect(screen.getByTestId('email').props.accessibilityHint).toBe('Usa tu correo laboral');
});

test('standalone input needs a label and uses dark tokens', async () => {
  expect(() => render(<Input value="" onChangeText={() => {}} />)).toThrow('accessibilityLabel');
  mockScheme = 'dark';
  const screen = await render(<Input value="" onChangeText={() => {}} accessibilityLabel="Buscar" placeholder="Buscar" testID="search" />);
  const input = screen.getByTestId('search');
  expect(input.props.accessibilityLabel).toBe('Buscar');
  expect(input.props.placeholderTextColor).toBe(tokens.colors.dark['muted-foreground']);
  expect(input.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: tokens.colors.dark.card, borderColor: tokens.colors.dark.input })]));
});

test('dark invalid and disabled fields keep their semantic colors', async () => {
  mockScheme = 'dark';
  const screen = await render(
    <Field invalid disabled>
      <FieldLabel>Notas</FieldLabel>
      <Input value="" onChangeText={() => {}} testID="notes" />
      <FieldError>Revisa las notas</FieldError>
    </Field>,
  );
  expect(screen.getByTestId('notes').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ borderColor: tokens.colors.dark.error, color: tokens.colors.dark['muted-foreground'] })]));
  expect(screen.getByText('Revisa las notas').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ color: tokens.colors.dark.error })]));
});

test('textarea remains controlled, multiline and focusable', async () => {
  const change = jest.fn();
  const ref = createRef<TextInput>();
  const screen = await render(<Textarea ref={ref} value="Nota" onChangeText={change} accessibilityLabel="Notas" testID="notes" />);
  const textarea = screen.getByTestId('notes');
  expect(textarea.props.multiline).toBe(true);
  expect(textarea.props.textAlignVertical).toBe('top');
  await fireEvent.changeText(textarea, 'Nueva nota');
  expect(change).toHaveBeenCalledWith('Nueva nota');
  expect(ref.current).toBeTruthy();
});

test('horizontal fields wrap supporting text and show a focus border', async () => {
  const screen = await render(
    <Field orientation="horizontal">
      <FieldLabel>Referencia</FieldLabel>
      <Input value="" onChangeText={() => {}} testID="reference" />
      <FieldDescription>Opcional</FieldDescription>
    </Field>,
  );
  const input = screen.getByTestId('reference');
  expect(input.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ flexGrow: 1 })]));
  expect(screen.getByText('Opcional').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: '100%' })]));
  await fireEvent(input, 'focus');
  expect(screen.getByTestId('reference').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ borderColor: tokens.colors.light.ring, borderWidth: tokens.sizing.focusWidth })]));
});
