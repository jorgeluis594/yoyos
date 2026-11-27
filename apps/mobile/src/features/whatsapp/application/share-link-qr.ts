import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";
import type { ReceptionStatus } from "@mobile/features/whatsapp/application/reception-lifecycle";

type LinkQr = ReceptionStatus["qr"];

export type ShareLinkQrDeps = Readonly<{
  subscribe: (listener: (status: ReceptionStatus) => void) => () => void;
  share: (qr: LinkQr) => Promise<Result<void, TransportError>>;
}>;

/**
 * Sends every new link QR to core, and its removal once it is gone, so the seller can scan it from Yoyos web.
 * Sharing is best effort: the phone keeps showing the QR when core is unreachable.
 */
export function shareLinkQrChanges(deps: ShareLinkQrDeps): () => void {
  let last: string | null = null;
  return deps.subscribe(({ qr }) => {
    const value = qr?.value ?? null;
    if (value === last) return;
    last = value;
    void deps.share(qr);
  });
}
