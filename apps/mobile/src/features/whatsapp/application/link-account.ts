import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { WhatsAppError } from "@mobile/modules/whatsapp/types";
import type { Clock, LinkStore, Session, StoreError, WhatsAppGateway } from "@mobile/features/whatsapp/application/ports";
import type { ReceptionHandle, StartError } from "@mobile/features/whatsapp/application/reception-lifecycle";
import type { WhatsAppLink } from "@mobile/features/whatsapp/domain/link";

export type LinkAccountError =
  | Readonly<{ code: "ALREADY_LINKED" | "NO_SESSION"; message: string }>
  | StartError | StoreError;

export type LinkAccountDeps = Readonly<{
  links: LinkStore;
  session: () => Session | null;
  now: Clock;
  /** Registers the message consumer, initializes and connects; the QR is delivered through the `qr` event. */
  startReception: () => Promise<Result<ReceptionHandle, StartError>>;
}>;

/** UC-01. The link is created first because reception only connects with an active link of the session company. */
export function linkAccount(deps: LinkAccountDeps): () => Promise<Result<WhatsAppLink, LinkAccountError>> {
  return async () => {
    const session = deps.session();
    if (!session) return err({ code: "NO_SESSION", message: "No Yoyos session" });
    const active = await deps.links.active();
    if (!active.success) return active;
    if (active.data) return err({ code: "ALREADY_LINKED", message: "A WhatsApp account is already linked" });

    const started = await deps.links.start(session.companyId, session.userId, deps.now());
    if (!started.success) return started;

    const connected = await deps.startReception();
    if (!connected.success) {
      // Close the link so linking can be retried.
      const ended = await deps.links.end(started.data.id, deps.now());
      return ended.success ? connected : ended;
    }
    return ok(started.data);
  };
}

export type UnlinkOutcome = Readonly<{ remoteLogoutConfirmed: boolean }>;
export type UnlinkError = StoreError | WhatsAppError | Readonly<{ code: "NOT_LINKED"; message: string }>;

export type UnlinkAccountDeps = Readonly<{
  links: LinkStore;
  whatsapp: Pick<WhatsAppGateway, "logout">;
  now: Clock;
}>;

/** UC-06. Pending messages of the ended link keep syncing; local data is not deleted. */
export function unlinkAccount(deps: UnlinkAccountDeps): () => Promise<Result<UnlinkOutcome, UnlinkError>> {
  return async () => {
    const active = await deps.links.active();
    if (!active.success) return active;
    if (!active.data) return err({ code: "NOT_LINKED", message: "No active WhatsApp link" });

    const loggedOut = await deps.whatsapp.logout();
    if (!loggedOut.success && loggedOut.error.code !== "REMOTE_LOGOUT_UNCONFIRMED") return loggedOut;

    const ended = await deps.links.end(active.data.id, deps.now());
    if (!ended.success) return ended;
    return ok({ remoteLogoutConfirmed: loggedOut.success });
  };
}
