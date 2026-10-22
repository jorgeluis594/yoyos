import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@core/app/components/ui/button";
import { Card } from "@core/app/components/ui/card";
import { cn } from "@core/app/lib/utils";
import { storeThemes } from "@shared/store-themes";
import type { PublicStoreAppearance } from "@core/src/features/store-appearance/presentation/store-appearance-schemas";
import { listenForPreviewReady, sendPreviewUpdate } from "@core/app/components/store-preview/preview-protocol";
import type { PreviewSurface, StorePreviewMessage } from "@core/app/components/store-preview/store-preview-schemas";

type Device = "phone" | "desktop";
export type StorePreviewFrameProps = Readonly<{
  /** The draft, applied to the preview as it changes. */
  appearance: PublicStoreAppearance;
  /** The catalog cards of the seller, samples, or `loading` while the editor has no answer yet. */
  catalog: StorePreviewMessage["catalog"];
  /** Path of the preview page; the private-access middleware completes the locale. */
  src?: string;
}>;

const deviceSizes: Record<Device, Readonly<{ width: number; height: number }>> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

function Segmented<T extends string>({ label, value, options, onChange, className }: Readonly<{
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; className?: string;
}>) {
  return <div role="group" aria-label={label} className="inline-flex gap-1 rounded-md border bg-card p-0.5">
    {options.map(([option, text]) => <Button key={option} type="button" size="sm" aria-pressed={value === option} className={className}
      variant={value === option ? "default" : "ghost"} onClick={() => onChange(option)}>{text}</Button>)}
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

export function StorePreviewFrame({ appearance, catalog, src = "/settings/store-appearance/preview" }: StorePreviewFrameProps) {
  const { t } = useTranslation();
  const [surface, setSurface] = useState<PreviewSurface>("catalog");
  const [device, setDevice] = useState<Device>("phone");
  const [state, setState] = useState<StorePreviewMessage["state"]>("review");
  const [canvas, canvasWidth] = useWidth();
  const frame = useRef<HTMLIFrameElement>(null);
  const titleId = useId();
  const { logoUrl, theme } = appearance;
  const message = useMemo<StorePreviewMessage>(() => ({
    type: "store-appearance:update", appearance: { logoUrl, theme }, surface, state, catalog,
  }), [logoUrl, theme, surface, state, catalog]);
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
  const origin = surface === "checkout" || catalog.kind === "samples" ? t("storePreview.samples") : catalog.kind === "loading" ? t("storePreview.loading") : t("storePreview.products");
  return <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
    <h2 id={titleId} className="sr-only">{t("storePreview.title")}</h2>
    <Segmented label={t("storePreview.surface")} value={surface} onChange={setSurface} className="min-h-touch"
      options={[["catalog", t("storePreview.catalog")], ["checkout", t("storePreview.checkout")]]} />
    <p role="status" className="text-sm text-muted-foreground">{t("storePreview.label", { theme: storeThemes[theme].name, origin })}</p>
    <div className="flex flex-wrap items-center gap-3">
      <Segmented label={t("storePreview.device")} value={device} onChange={setDevice}
        options={[["phone", t("storePreview.phone")], ["desktop", t("storePreview.desktop")]]} />
      {surface === "checkout" && <Segmented label={t("storePreview.state")} value={state} onChange={setState}
        options={[["review", t("storePreview.review")], ["payment", t("storePreview.payment")]]} />}
    </div>
    <Card className="min-w-0 gap-0 overflow-hidden py-0"><div ref={canvas} className="min-w-0 overflow-hidden p-2">
      <div className="mx-auto" style={{ width: size.width * scale, height: size.height * scale }}>
        <iframe ref={frame} title={t("storePreview.title")} src={src} sandbox="allow-scripts allow-same-origin"
          data-device={device}
          className={cn("block origin-top-left bg-background", device === "phone" ? "rounded-[2rem] ring-4 ring-foreground/80" : "rounded-md ring-1 ring-border")}
          style={{ width: size.width, height: size.height, transform: `scale(${scale})` }} />
      </div>
    </div></Card>
  </section>;
}
