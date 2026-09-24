import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ok, err } from '@shared/functional';
import { AccessProvider } from './access-provider';
import { AccessScreen } from './access-screen';
import type { ReadyAccess, RegistrationError } from '@/features/users';
import type { Result } from '@shared/result';

const pending = { status: 'company_required' as const, user: { id: 'u', name: 'A', companyId: null }, company: null };
const ready = { status: 'ready' as const, user: { id: 'u', name: 'A', companyId: 'c' }, company: { id: 'c', name: 'Shop', country: 'PE' as const } };
function setup(overrides: Partial<React.ComponentProps<typeof AccessProvider>['operations']> = {}) {
  const operations = {
    restoreSession: jest.fn(async () => ok(null)),
    signIn: jest.fn(async () => ok(pending)),
    register: jest.fn(async () => ok(ready)),
    completeCompany: jest.fn(async () => ok(ready)),
    signOut: jest.fn(async (clear: () => void) => { clear(); return ok({ remoteRevocation: 'unconfirmed' as const }); }),
    ...overrides,
  };
  const view = render(<AccessProvider operations={operations}><AccessScreen /></AccessProvider>);
  return { ...operations, unmount: view.unmount };
}

test('restoration hides forms, network failure retries, and pending session asks for company again', async () => {
  let resolve!: (value: unknown) => void;
  const restoreSession = jest.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValueOnce(ok(pending));
  setup({ restoreSession });
  expect(screen.getByText('Comprobando sesión…')).toBeTruthy();
  expect(screen.queryByLabelText('Correo *')).toBeNull();
  resolve(err({ code: 'NETWORK_ERROR', message: 'offline' }));
  await screen.findByText('No se pudo comprobar el acceso');
  fireEvent.press(screen.getByLabelText('Reintentar'));
  await screen.findByText('Completa tu empresa');
  expect(screen.getByLabelText('Nombre de empresa *')).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Perú' }).props.accessibilityState.checked).toBe(false);
});

test('registration validates fields, sends once, and recovers company without another sign-up', async () => {
  let resolve!: (value: Result<ReadyAccess, RegistrationError>) => void;
  const register = jest.fn(() => new Promise<Result<ReadyAccess, RegistrationError>>((done) => { resolve = done; }));
  const restoreSession = jest.fn().mockResolvedValueOnce(ok(null)).mockResolvedValueOnce(ok(pending));
  const operations = setup({ register, restoreSession });
  await screen.findByLabelText('Correo *');
  fireEvent.press(screen.getByLabelText('Crear una cuenta'));
  fireEvent.press(screen.getByLabelText('Crear cuenta'));
  expect(screen.getByText(/Completa todos los campos/)).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Nombre *'), 'Ana');
  fireEvent.changeText(screen.getByLabelText('Correo *'), 'ana@example.com');
  fireEvent.changeText(screen.getByLabelText('Contraseña *'), 'password123');
  fireEvent.changeText(screen.getByLabelText('Nombre de empresa *'), 'Shop');
  fireEvent.press(screen.getByRole('radio', { name: 'Perú' }));
  fireEvent.press(screen.getByLabelText('Crear cuenta'));
  fireEvent.press(screen.getByLabelText('Enviando…'));
  expect(register).toHaveBeenCalledTimes(1);
  resolve(err({ code: 'REGISTRATION_INTERRUPTED', message: 'failed', step: 'company', recovery: 'reload_access_then_complete_company', cause: { code: 'NETWORK_ERROR', message: 'offline' } }));
  await screen.findByText('Completa tu empresa');
  expect(screen.getByLabelText('Nombre de empresa *').props.value).toBe('Shop');
  fireEvent.press(screen.getByLabelText('Crear empresa'));
  await waitFor(() => expect(operations.completeCompany).toHaveBeenCalledWith({ name: 'Shop', country: 'PE' }));
  expect(register).toHaveBeenCalledTimes(1);
});

test('storage cleanup failure offers retry, then returns to public access', async () => {
  const signOut = jest.fn().mockImplementationOnce(async (clear: () => void) => { clear(); return err({ code: 'SECURE_STORAGE_ERROR', message: 'storage' }); }).mockImplementationOnce(async (clear: () => void) => { clear(); return ok({ remoteRevocation: 'unconfirmed' }); });
  setup({ restoreSession: jest.fn(async () => ok(pending)), signOut });
  await screen.findByText('Completa tu empresa');
  fireEvent.press(screen.getByLabelText('Cerrar sesión'));
  await screen.findByText('No se pudo comprobar el acceso');
  expect(screen.queryByLabelText('Correo *')).toBeNull();
  fireEvent.press(screen.getByLabelText('Reintentar limpieza'));
  await screen.findByText('Bienvenido a Yoyos');
  expect(signOut).toHaveBeenCalledTimes(2);
});

test('pending company failure stays on its form and retry completes access', async () => {
  const completeCompany = jest.fn().mockResolvedValueOnce(err({ code: 'COMPANY_SETUP_INTERRUPTED', message: 'failed', step: 'create', cause: { code: 'NETWORK_ERROR', message: 'offline' } })).mockResolvedValueOnce(ok(ready));
  setup({ restoreSession: jest.fn(async () => ok(pending)), completeCompany });
  await screen.findByText('Completa tu empresa');
  fireEvent.changeText(screen.getByLabelText('Nombre de empresa *'), 'Shop');
  fireEvent.press(screen.getByRole('radio', { name: 'Perú' }));
  fireEvent.press(screen.getByLabelText('Crear empresa'));
  await screen.findByText(/Sin conexión/);
  expect(screen.getByText('Completa tu empresa')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Crear empresa'));
  await waitFor(() => expect(completeCompany).toHaveBeenCalledTimes(2));
});

test('wrong credentials show a local error and do not change access', async () => {
  setup({ signIn: jest.fn(async () => err({ code: 'SIGN_IN_INTERRUPTED', message: 'failed', step: 'credentials', cause: { code: 'INVALID_CREDENTIALS', message: 'bad' } } as const)) });
  fireEvent.changeText(await screen.findByLabelText('Correo *'), 'ana@example.com');
  fireEvent.changeText(screen.getByLabelText('Contraseña *'), 'wrong');
  fireEvent.press(screen.getByLabelText('Iniciar sesión'));
  await screen.findByText('Correo o contraseña incorrectos.');
  expect(screen.getByText('Bienvenido a Yoyos')).toBeTruthy();
});


test('recreating the provider asks for a pending company draft again', async () => {
  const first = setup({ restoreSession: jest.fn(async () => ok(pending)) });
  await screen.findByText('Completa tu empresa');
  fireEvent.changeText(screen.getByLabelText('Nombre de empresa *'), 'Shop');
  fireEvent.press(screen.getByRole('radio', { name: 'Perú' }));
  first.unmount();
  setup({ restoreSession: jest.fn(async () => ok(pending)) });
  await screen.findByText('Completa tu empresa');
  expect(screen.getByLabelText('Nombre de empresa *').props.value).toBe('');
  expect(screen.getByRole('radio', { name: 'Perú' }).props.accessibilityState.checked).toBe(false);
});
