import type { NoticeGateway, NoticePermission, NoticeStore } from "./ports";

export type NoticePermissionDependencies = Readonly<{
  gateway: NoticeGateway;
  store: NoticeStore;
  /** Shows the two-button explanation; resolves `true` for «Activar avisos». */
  confirm: () => Promise<boolean>;
}>;

/** Asks once per installation, the first time the WhatsApp link is connected. */
export async function promptForNotices(dependencies: NoticePermissionDependencies): Promise<NoticePermission> {
  const { gateway, store, confirm } = dependencies;
  const current = await gateway.permission();
  if (current !== "undetermined" || (await store.wasPrompted())) return current;
  await store.markPrompted();
  return (await confirm()) ? gateway.requestPermission() : current;
}

/** The banner button: the system dialog if it was never shown, the phone's settings after a denial. */
export async function enableNotices(dependencies: Pick<NoticePermissionDependencies, "gateway" | "store">): Promise<NoticePermission> {
  const { gateway, store } = dependencies;
  const current = await gateway.permission();
  if (current === "granted") return current;
  if (current === "denied") {
    await gateway.openSettings();
    return current;
  }
  await store.markPrompted();
  return gateway.requestPermission();
}
