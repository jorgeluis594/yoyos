import { err, ok } from '@shared/functional';
import { register } from './register';

const account = { name: 'Ana', email: 'Ana+ventas@example.com', password: ' pass word ' };

test('registration validates account details before calling authentication and returns accepted', async () => {
  let received: unknown;
  let calls = 0;
  const registerAccount = async (input: typeof account) => { received = input; calls++; return ok(undefined); };
  expect(await register({ ...account, email: 'bad' }, { registerAccount })).toMatchObject({ success: false, error: { cause: { code: 'INVALID_INPUT' } } });
  expect(calls).toBe(0);
  expect(await register(account, { registerAccount })).toEqual(ok({ status: 'accepted' }));
  expect(received).toEqual({ name: 'Ana', email: 'ana+ventas@example.com', password: ' pass word ' });
});

test('registration does not load access, request a token, or create a company', async () => {
  const failure = err({ code: 'NETWORK_ERROR' as const, message: 'offline' });
  expect(await register(account, { registerAccount: async () => failure })).toMatchObject({ success: false, error: { cause: { code: 'NETWORK_ERROR' } } });
});
