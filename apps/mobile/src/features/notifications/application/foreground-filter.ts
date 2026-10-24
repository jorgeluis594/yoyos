import { shouldShowNotice, type NoticeSession } from "../domain/notice-destination";
import type { NoticeStore } from "./ports";

export type ForegroundDecision = "show" | "hide";

/**
 * A foreground notice of another company (or while signed out) is hidden and the device's token
 * is queued for unregistering, so a session that could not be revoked stops receiving notices.
 */
export async function decideForegroundNotice(data: unknown, session: NoticeSession, store: NoticeStore): Promise<ForegroundDecision> {
  if (shouldShowNotice(data, session)) return "show";
  const registration = await store.readRegistration();
  if (registration !== null) await store.writePendingUnregister(registration.token);
  return "hide";
}
