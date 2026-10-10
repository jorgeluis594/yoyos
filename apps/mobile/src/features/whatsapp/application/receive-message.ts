import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { WhatsAppError, WhatsAppEvents } from "@mobile/modules/whatsapp/types";
import type { Clock, LinkStore, MessageStore, Placement, StoreError, WhatsAppGateway } from "@mobile/features/whatsapp/application/ports";
import { fromReceivedMessage } from "@mobile/features/whatsapp/domain/inbound-message";
import { assignLink } from "@mobile/features/whatsapp/domain/link";

export type ReceiveOutcome = Readonly<{ status: "stored" | "duplicate" | "orphaned" | "invalid" }>;
export type ReceiveError = StoreError | WhatsAppError;

export type ReceiveMessageDeps = Readonly<{
  store: MessageStore;
  links: LinkStore;
  whatsapp: Pick<WhatsAppGateway, "confirmMessageStored">;
  now: Clock;
  wakeSync: () => void;
}>;

type ReceivedEvent = WhatsAppEvents["messageReceived"];

/**
 * Critical path: the delivery is confirmed to the library only after the local commit.
 * No network calls and no logging of message content here.
 */
export function receiveMessage(deps: ReceiveMessageDeps): (event: ReceivedEvent) => Promise<Result<ReceiveOutcome, ReceiveError>> {
  return async (event) => {
    const parsed = fromReceivedMessage(event.message);
    if (!parsed.success) {
      // Unsupported content would block the native queue forever if left unconfirmed.
      const confirmed = await deps.whatsapp.confirmMessageStored(event.deliveryId);
      return confirmed.success ? ok({ status: "invalid" }) : confirmed;
    }
    const message = parsed.data;

    const links = await deps.links.all();
    if (!links.success) return links;
    const assignment = assignLink(links.data, message.accountId);
    const placement: Placement = assignment.kind === "orphan"
      ? { kind: "orphan" }
      : { kind: "linked", link: assignment.link, claim: assignment.kind === "claim", initial: message.sentAt === null ? "held_unknown_date" : "pending" };

    const saved = await deps.store.saveOnce(message, placement, deps.now());
    if (!saved.success) return err(saved.error);

    const needsSync = saved.data.status === "stored" && saved.data.message.sync.state === "pending";
    if (needsSync) deps.wakeSync();

    // A failed confirmation is safe: the redelivery arrives as a duplicate and is confirmed then.
    const confirmed = await deps.whatsapp.confirmMessageStored(event.deliveryId);
    if (!confirmed.success) return confirmed;

    if (saved.data.status === "duplicate") return ok({ status: "duplicate" });
    return ok({ status: saved.data.message.sync.state === "orphaned" ? "orphaned" : "stored" });
  };
}
