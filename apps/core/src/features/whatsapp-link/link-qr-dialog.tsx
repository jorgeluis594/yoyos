import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { linkQrSocketMessageSchema, linkQrSocketPath, type LinkQr } from "@shared/contracts/whatsapp-link-qr";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { QrCode } from "@core/app/components/qr-code";

const reconnectMs = 3_000;

/**
 * Keeps a WebSocket open while the page is mounted and returns the live link QR the phone shared, or null.
 * A dismissed QR stays hidden until the phone stops asking for one.
 */
function useLinkQr() {
  const [qr, setQr] = useState<LinkQr | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}${linkQrSocketPath}`);
      socket.onmessage = (event) => {
        const message = linkQrSocketMessageSchema.safeParse(typeof event.data === "string" ? safeJson(event.data) : null);
        if (!message.success) return;
        setQr(message.data.type === "qr" ? message.data.qr : null);
        if (message.data.type === "cleared") setDismissed(false);
      };
      socket.onclose = () => {
        setQr(null);
        setDismissed(false);
        if (!stopped) retry = setTimeout(connect, reconnectMs);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retry !== null) clearTimeout(retry);
      socket?.close();
    };
  }, []);
  return { qr, dismissed, dismiss: () => setDismissed(true) } as const;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function useSecondsLeft(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === null) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [expiresAt]);
  return expiresAt === null ? 0 : Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1_000));
}

/**
 * Shows the QR the seller requested on the phone so WhatsApp can scan it from this screen.
 * It opens by itself when a QR arrives and closes once the phone links or cancels.
 */
export function LinkQrDialog() {
  const { t } = useTranslation();
  const { qr, dismissed, dismiss } = useLinkQr();
  const secondsLeft = useSecondsLeft(qr?.expiresAt ?? null);
  const expired = qr !== null && secondsLeft === 0;

  return (
    <Dialog open={qr !== null && !dismissed} onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent closeLabel={t("whatsappLinkQr.close")} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("whatsappLinkQr.title")}</DialogTitle>
          <DialogDescription>{t("whatsappLinkQr.description")}</DialogDescription>
        </DialogHeader>
        {qr && !expired ? (
          <div className="flex flex-col items-center gap-3">
            <QrCode value={qr.value} label={t("whatsappLinkQr.qrLabel")} className="size-64 rounded-sm" />
            <p className="text-sm text-muted-foreground" aria-live="polite">{t("whatsappLinkQr.expiresIn", { seconds: secondsLeft })}</p>
          </div>
        ) : (
          <p role="alert" className="text-sm">{t("whatsappLinkQr.expired")}</p>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("whatsappLinkQr.stepOpen")}</li>
          <li>{t("whatsappLinkQr.stepDevices")}</li>
          <li>{t("whatsappLinkQr.stepScan")}</li>
        </ol>
      </DialogContent>
    </Dialog>
  );
}
