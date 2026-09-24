import { fireEvent, render } from '@testing-library/react-native';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import tokens from '../../../../../docs/design-tokens.json';
import { Button } from '@/components/ui/button';
import { ScreenState, type ScreenStateProps } from '@/components/ui/screen-state';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => mockScheme }));

beforeEach(() => { mockScheme = 'light'; });

test.each(['light', 'dark'] as const)('renders all states with %s theme tokens', async (scheme) => {
  mockScheme = scheme;
  for (const status of ['loading', 'empty', 'no-results', 'error'] as ScreenStateProps['status'][]) {
    const screen = await render(<ScreenState status={status} title={status} description="Descripción" />);
    expect(StyleSheet.flatten(screen.getByText(status).props.style).color).toBe(tokens.colors[scheme].foreground);
    expect(StyleSheet.flatten(screen.getByText('Descripción').props.style).color).toBe(tokens.colors[scheme]['muted-foreground']);
    expect(screen.UNSAFE_queryByType(ActivityIndicator) !== null).toBe(status === 'loading');
    screen.unmount();
  }
});

test('loading announces progress and hides other content', async () => {
  const screen = await render(<ScreenState status="loading" title="Cargando pedidos" media={<Text>Media</Text>} action={<Text>Acción</Text>} />);
  expect(screen.getByRole('progressbar').props.accessibilityState).toEqual({ busy: true });
  expect(screen.getByRole('progressbar').props.accessibilityLabel).toBe('Cargando pedidos');
  expect(screen.queryByText('Media')).toBeNull();
  expect(screen.queryByText('Acción')).toBeNull();
});

test('empty state accepts media and a useful action; error retries', async () => {
  const action = jest.fn();
  const retry = jest.fn();
  const screen = await render(<ScreenState status="empty" title="Sin pedidos" media={<Text>Ilustración</Text>} action={<Button onPress={action}>Crear pedido</Button>} />);
  expect(screen.getByText('Ilustración')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Crear pedido' }));
  expect(action).toHaveBeenCalledTimes(1);

  await screen.rerender(<ScreenState status="error" title="No pudimos cargar" onRetry={retry} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
