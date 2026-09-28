import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { err, ok } from '@shared/functional';
import { AccessProvider } from './access-provider';
import { AccessScreen } from './access-screen';

const pending = { status: 'company_required' as const, user: { id: 'u', name: 'A', companyId: null }, company: null };
const ready = { status: 'ready' as const, user: { id: 'u', name: 'A', companyId: 'c' }, company: { id: 'c', name: 'Shop', country: 'PE' as const } };
function setup(overrides: Partial<React.ComponentProps<typeof AccessProvider>['operations']> = {}) {
  const operations = {
    restoreSession: jest.fn(async () => ok(null)),
    signIn: jest.fn(async () => ok(pending)),
    register: jest.fn(async () => ok({ status: 'accepted' as const })),
    requestVerification: jest.fn(async () => ok(undefined)),
    requestPasswordReset: jest.fn(async () => ok(undefined)),
    completeCompany: jest.fn(async () => ok(ready)),
    signOut: jest.fn(async (clear: () => void) => { clear(); return ok({ remoteRevocation: 'unconfirmed' as const }); }),
    ...overrides,
  };
  render(<AccessProvider operations={operations}><AccessScreen /></AccessProvider>);
  return operations;
}

test('registration sends only account details and moves to neutral verification state', async () => {
  const operations = setup();
  await screen.findByLabelText('Correo *');
  fireEvent.press(screen.getByLabelText('Crear una cuenta'));
  fireEvent.changeText(screen.getByLabelText('Nombre *'), 'Ana');
  fireEvent.changeText(screen.getByLabelText('Correo *'), 'ana@example.com');
  fireEvent.changeText(screen.getByLabelText('Contraseña *'), 'password123');
  fireEvent.press(screen.getByLabelText('Crear cuenta'));
  await screen.findByText('Revisa tu correo si tienes una verificación pendiente. Inicia sesión después de verificar.');
  expect(operations.register).toHaveBeenCalledWith({ name: 'Ana', email: 'ana@example.com', password: 'password123' });
  expect(screen.queryByLabelText('Contraseña *')).toBeNull();
  fireEvent.press(screen.getByLabelText('Reenviar verificación'));
  await waitFor(() => expect(operations.requestVerification).toHaveBeenCalledWith('ana@example.com'));
  await screen.findByText('Si tienes una verificación pendiente, recibirás un enlace.');
});

test('registration errors leave the account form available and clear the password after submit', async () => {
  const operations = setup({ register: jest.fn(async () => err({ code: 'REGISTRATION_FAILED' as const, message: 'failed', cause: { code: 'NETWORK_ERROR' as const, message: 'offline' } })) });
  await screen.findByLabelText('Correo *');
  fireEvent.press(screen.getByLabelText('Crear una cuenta'));
  fireEvent.changeText(screen.getByLabelText('Nombre *'), 'Ana');
  fireEvent.changeText(screen.getByLabelText('Correo *'), 'ana@example.com');
  fireEvent.changeText(screen.getByLabelText('Contraseña *'), 'password123');
  fireEvent.press(screen.getByLabelText('Crear cuenta'));
  await screen.findByText('Sin conexión. Comprueba tu red y vuelve a intentar.');
  expect(screen.getByLabelText('Contraseña *').props.value).toBe('');
  expect(operations.requestVerification).not.toHaveBeenCalled();
});

test('login exposes verification resend and neutral password recovery requests', async () => {
  const operations = setup();
  fireEvent.changeText(await screen.findByLabelText('Correo *'), 'ana@example.com');
  fireEvent.press(screen.getByLabelText('Reenviar verificación'));
  await waitFor(() => expect(operations.requestVerification).toHaveBeenCalledWith('ana@example.com'));
  fireEvent.press(screen.getByLabelText('Recuperar contraseña'));
  await waitFor(() => expect(operations.requestPasswordReset).toHaveBeenCalledWith('ana@example.com'));
});

test('verified account can finish company onboarding', async () => {
  const operations = setup({ restoreSession: jest.fn(async () => ok(pending)) });
  await screen.findByText('Completa tu empresa');
  fireEvent.changeText(screen.getByLabelText('Nombre de empresa *'), 'Shop');
  fireEvent.press(screen.getByRole('radio', { name: 'Perú' }));
  fireEvent.press(screen.getByLabelText('Crear empresa'));
  await waitFor(() => expect(operations.completeCompany).toHaveBeenCalledWith({ name: 'Shop', country: 'PE' }));
});
