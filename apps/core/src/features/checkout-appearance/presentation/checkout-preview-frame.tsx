import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@core/app/lib/utils";
import type { CheckoutPreviewMessage, CheckoutPreviewMode, PublicCheckoutAppearance } from "@core/src/features/checkout-appearance/presentation/checkout-appearance-schemas";
import { listenForPreviewReady, sendPreviewUpdate } from "@core/src/features/checkout-appearance/presentation/preview-protocol";

type Device = "phone" | "desktop";
export type CheckoutPreviewFrameProps = Readonly<{
  /** The draft, applied to the preview as it changes. */
  appearance: PublicCheckoutAppearance;
  /** Active preview mode; owned by the editor so its swatches follow it. */
  mode: CheckoutPreviewMode;
  onModeChange: (mode: CheckoutPreviewMode) => void;
  /** Path of the preview page; the private-access middleware completes the locale. */
  src?: string;
}>;

const deviceSizes: Record<Device, Readonly<{ width: number; height: number }>> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

function Segmented<T extends string>({ label, value, options, onChange }: Readonly<{
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void;
}>) {
  return <div role="group" aria-label={label} className="inline-flex rounded-md border bg-card p-0.5">
    {options.map(([option, text]) => <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}
      className={cn("min-h-8 rounded-sm px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
        value === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>{text}</button>)}
  </div>;
}

/** Width of the element, or `null` until it is measured (and in environments without layout). */
function useWidth() {
  const [width, setWidth] = useState<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!node || typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.current.observe(node);
  }, []);
  return [ref, width] as const;
}

export function CheckoutPreviewFrame({ appearance, mode, onModeChange, src = "/settings/checkout-appearance/preview" }: CheckoutPreviewFrameProps) {
  const { t } = useTranslation();
  const [device, setDevice] = useState<Device>("phone");
  const [state, setState] = useState<CheckoutPreviewMessage["state"]>("review");
  const [canvas, canvasWidth] = useWidth();
  const frame = useRef<HTMLIFrameElement>(null);
  const titleId = useId();
  const { logoUrl, brandColor, background } = appearance;
  const message = useMemo<CheckoutPreviewMessage>(() => ({
    type: "checkout-appearance:update", appearance: { logoUrl, brandColor, background }, mode, state,
  }), [logoUrl, brandColor, background, mode, state]);
  const latest = useRef(message);

  const send = useCallback(() => {
    const target = frame.current?.contentWindow;
    // An invalid draft is not sent, so the preview keeps its last valid view.
    if (target) sendPreviewUpdate(target, latest.current);
  }, []);
  useEffect(() => listenForPreviewReady(window, () => frame.current?.contentWindow ?? null, send), [send]);
  useEffect(() => {
    latest.current = message;
    send();
  }, [message, send]);

  const size = deviceSizes[device];
  const scale = canvasWidth ? Math.min(1, canvasWidth / size.width) : 1;
  return <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
    <h2 id={titleId} className="sr-only">{t("checkoutPreview.title")}</h2>
    <div className="flex flex-wrap items-center gap-3">
      <Segmented label={t("checkoutPreview.device")} value={device} onChange={setDevice}
        options={[["phone", t("checkoutPreview.phone")], ["desktop", t("checkoutPreview.desktop")]]} />
      <Segmented label={t("checkoutPreview.mode")} value={mode} onChange={onModeChange}
        options={[["light", t("checkoutPreview.light")], ["dark", t("checkoutPreview.dark")]]} />
      <Segmented label={t("checkoutPreview.state")} value={state} onChange={setState}
        options={[["review", t("checkoutPreview.review")], ["payment", t("checkoutPreview.payment")]]} />
    </div>
    <div ref={canvas} className="min-w-0 overflow-hidden p-2">
      <div className="mx-auto" style={{ width: size.width * scale, height: size.height * scale }}>
        <iframe ref={frame} title={t("checkoutPreview.title")} src={src} sandbox="allow-scripts allow-same-origin"
          data-device={device}
          className={cn("block origin-top-left bg-background", device === "phone" ? "rounded-[2rem] ring-4 ring-foreground/80" : "rounded-md ring-1 ring-border")}
          style={{ width: size.width, height: size.height, transform: `scale(${scale})` }} />
      </div>
    </div>
  </section>;
}
