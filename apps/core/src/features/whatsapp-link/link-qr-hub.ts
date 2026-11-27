import type { LinkQr } from "@shared/contracts/whatsapp-link-qr";

type Listener = (qr: LinkQr | null) => void;

/**
 * Relays the WhatsApp link QR from the phone to the company's open web sessions. It lives in memory only:
 * a QR expires in seconds, so a restart just waits for the phone's next QR.
 */
export function createLinkQrHub(now: () => number = Date.now) {
  const current = new Map<string, LinkQr>();
  const listeners = new Map<string, Set<Listener>>();
  const isLive = (qr: LinkQr) => Date.parse(qr.expiresAt) > now();

  return {
    share(companyId: string, qr: LinkQr | null) {
      if (qr === null || !isLive(qr)) current.delete(companyId);
      else current.set(companyId, qr);
      const next = current.get(companyId) ?? null;
      for (const listener of listeners.get(companyId) ?? []) listener(next);
    },
    /** The listener first receives the live QR, if any, then every change. */
    subscribe(companyId: string, listener: Listener): () => void {
      const set = listeners.get(companyId) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(companyId, set);
      const qr = current.get(companyId);
      if (qr && isLive(qr)) listener(qr);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(companyId);
      };
    },
  } as const;
}

export type LinkQrHub = ReturnType<typeof createLinkQrHub>;

export const linkQrHub = createLinkQrHub();
