import { fireEvent, render } from '@testing-library/react-native';
import HomeScreen from '@mobile/app/index';
import '@mobile/i18n';

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockSignOut = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, navigate: mockNavigate }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('@mobile/features/users/presentation/access-provider', () => ({ useAccess: () => ({
  state: { status: 'ready', company: { name: 'Mi tienda' }, user: { name: 'Ana' } }, signOut: mockSignOut,
}) }));

test('home opens order and catalog tasks and preserves sign out', () => {
  const screen = render(<HomeScreen />);
  fireEvent.press(screen.getByRole('button', { name: /Nueva venta/ }));
  expect(mockPush).toHaveBeenLastCalledWith('/orders/new');
  fireEvent.press(screen.getByRole('button', { name: /Ver pedidos/ }));
  expect(mockNavigate).toHaveBeenLastCalledWith('/orders');
  fireEvent.press(screen.getByRole('button', { name: /Ver productos/ }));
  expect(mockNavigate).toHaveBeenLastCalledWith('/products');
  fireEvent.press(screen.getByRole('button', { name: /Agregar producto/ }));
  expect(mockPush).toHaveBeenLastCalledWith('/products/new');
  fireEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});
