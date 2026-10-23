import type { NoticeGateway, NoticeStore } from "./ports";

export type RemoteRevocation = "confirmed" | "unconfirmed";

/**
 * Sign-out cleanup: the shown notices go and the fingerprint is cleared. When core could not
 * delete the session, the token is kept as a pending unregister so the stray device is removed later.
 */
export async function cleanNoticesOnSignOut(
  revocation: RemoteRevocation,
  dependencies: Readonly<{ gateway: NoticeGateway; store: NoticeStore }>,
): Promise<void> {
  const { gateway, store } = dependencies;
  const registration = await store.readRegistration();
  await store.clearRegistration();
  if (revocation === "unconfirmed" && registration !== null) await store.writePendingUnregister(registration.token);
  await gateway.dismissAll();
}
