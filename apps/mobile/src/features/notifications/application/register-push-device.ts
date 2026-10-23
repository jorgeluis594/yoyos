import type { NoticeGateway, NoticeLocale, NoticeStore, PushDeviceApi } from "./ports";

export type RegistrationOutcome = "registered" | "unchanged" | "skipped" | "failed";
export type RegistrationDependencies = Readonly<{
  gateway: NoticeGateway;
  store: NoticeStore;
  api: PushDeviceApi;
  platform: "ios" | "android";
}>;

export const registrationFingerprint = (token: string, locale: NoticeLocale, sessionId: string) => `${token}|${locale}|${sessionId}`;

/**
 * Sends the device only when `(token, locale, sessionId)` differs from the last successful
 * registration. A failure stores nothing, so the next check retries.
 */
export async function registerPushDevice(
  session: Readonly<{ sessionId: string; locale: NoticeLocale }>,
  dependencies: RegistrationDependencies,
): Promise<RegistrationOutcome> {
  const { gateway, store, api, platform } = dependencies;
  if ((await gateway.permission()) !== "granted") return "skipped";
  const token = await gateway.getToken();
  if (!token.success) return "failed";
  const fingerprint = registrationFingerprint(token.data, session.locale, session.sessionId);
  if ((await store.readRegistration())?.fingerprint === fingerprint) return "unchanged";
  const sent = await api.register({ version: 1, token: token.data, platform, locale: session.locale });
  if (!sent.success) return "failed";
  await store.writeRegistration({ fingerprint, token: token.data });
  return "registered";
}

/**
 * Sends the unregister left by an offline sign-out or a hidden foreign notice; cleared only after a 204.
 * Core deletes by token, so when the token is the phone's current registration the stored
 * registration is cleared too and the next registration check sends the device again.
 */
export async function flushPendingUnregister(dependencies: Pick<RegistrationDependencies, "store" | "api">): Promise<boolean> {
  const { store, api } = dependencies;
  const token = await store.readPendingUnregister();
  if (token === null) return false;
  const sent = await api.unregister(token);
  if (!sent.success) return false;
  await store.clearPendingUnregister();
  if ((await store.readRegistration())?.token === token) await store.clearRegistration();
  return true;
}
