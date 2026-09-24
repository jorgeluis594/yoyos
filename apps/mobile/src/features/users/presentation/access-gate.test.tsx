import { fireEvent, render, screen } from '@testing-library/react-native';
import { ok } from '@shared/functional';
import { AccessProvider, useAccess } from '@/features/users/presentation/access-provider';
import { Pressable } from 'react-native';
import { AccessGate } from '@/composition/access-gate';
import { createAuthOperations } from '@/composition/create-auth-operations';

jest.mock('@/components/app-tabs', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return function Tabs() { return <MockText>Private tabs</MockText>; };
});

function LogoutTrigger() {
  const { signOut } = useAccess();
  return <Pressable accessibilityRole="button" accessibilityLabel="Test logout" onPress={() => void signOut()} />;
}

const ready = { status: 'ready' as const, user: { id: 'u', name: 'A', companyId: 'c' }, company: { id: 'c', name: 'Shop', country: 'PE' as const } };
const operations = {
  restoreSession: jest.fn(async () => ok(ready)),
  signIn: jest.fn(async () => ok(ready)),
  register: jest.fn(async () => ok(ready)),
  completeCompany: jest.fn(async () => ok(ready)),
  signOut: jest.fn(async (clear: () => void) => { clear(); return ok({ remoteRevocation: 'unconfirmed' as const }); }),
};

test('only ready mounts private routes, and logout removes them', async () => {
  render(<AccessProvider operations={operations}><AccessGate /><LogoutTrigger /></AccessProvider>);
  expect(screen.queryByText('Private tabs')).toBeNull();
  await screen.findByText('Private tabs');
  fireEvent.press(screen.getByLabelText('Test logout'));
  await screen.findByText('Bienvenido a Yoyos');
  expect(screen.queryByText('Private tabs')).toBeNull();
});

test('late sign-in result cannot remount private routes after logout', async () => {
  let finish!: (value: ReturnType<typeof ok<typeof ready>>) => void;
  const signIn = jest.fn(() => new Promise<ReturnType<typeof ok<typeof ready>>>((resolve) => { finish = resolve; }));
  render(<AccessProvider operations={{ ...operations, restoreSession: async () => ok(null), signIn }}><AccessGate /><LogoutTrigger /></AccessProvider>);
  fireEvent.changeText(await screen.findByLabelText('Correo *'), 'a@example.com');
  fireEvent.changeText(screen.getByLabelText('Contraseña *'), 'password');
  fireEvent.press(screen.getByLabelText('Iniciar sesión'));
  fireEvent.press(screen.getByLabelText('Test logout'));
  finish(ok(ready));
  await screen.findByText('Bienvenido a Yoyos');
  expect(screen.queryByText('Private tabs')).toBeNull();
});

test('the real composed operations connect login to the private gate', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const jwt = `e30.${btoa(JSON.stringify({ exp: 4_102_444_800 })).replace(/=/g, '')}.sig`;
  const client = {
    signUp: async () => ({ data: { user: { id: 'u' } }, error: null }),
    signIn: async () => ({ data: { user: { id: 'u' } }, error: null }),
    getSession: async () => ({ data: { session: { id: 's', expiresAt: '2100-01-01T00:00:00.000Z' }, user: { id: 'u', email: 'a@example.com' } }, error: null }),
    token: async () => ({ data: { token: jwt }, error: null }),
    signOut: async () => ({ data: { success: true }, error: null }),
  };
  let active = false;
  const storage = { getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} };
  const fetcher: typeof fetch = async () => Response.json({ status: 'ready', user: { id: 'u', name: 'A', companyId: id }, company: { id, name: 'Shop', country: 'PE' } });
  const composed = createAuthOperations({ ...client, getSession: async () => ({ data: active ? (await client.getSession()).data : null, error: null }), signIn: async () => { active = true; return client.signIn(); } }, storage, fetcher);
  render(<AccessProvider operations={composed}><AccessGate /></AccessProvider>);
  fireEvent.changeText(await screen.findByLabelText('Correo *'), 'a@example.com');
  fireEvent.changeText(screen.getByLabelText('Contraseña *'), 'password');
  fireEvent.press(screen.getByLabelText('Iniciar sesión'));
  await screen.findByText('Private tabs');
});
