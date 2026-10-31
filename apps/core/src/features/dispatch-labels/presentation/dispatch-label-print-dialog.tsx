import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import type { TFunction } from "i18next";
import { Download, Printer } from "lucide-react";
import { localizedPath } from "@core/app/locale";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Select, SelectContent, SelectItem, SelectPortalContainer, SelectTrigger, SelectValue } from "@core/app/components/ui/select";
import { dispatchLabelSizes, type CreateDispatchLabelsResponse, type DispatchLabelSize } from "@shared/contracts/dispatch-labels";
import type { DispatchLabelExclusion } from "@shared/dispatch-label/types";
import { pdfBlobFromBase64, requestDispatchLabels } from "@core/src/features/dispatch-labels/presentation/dispatch-labels-client";
import { salesTimeZone } from "@shared/orders-date";

const defaultSize: DispatchLabelSize = "label_62x100";

/** The reason wording is the app's, so a seller sees the same text on both. */
export function exclusionText(t: TFunction, exclusion: DispatchLabelExclusion): string {
  return exclusion.code === "MISSING_DATA"
    ? t("dispatchLabels.missingData", { fields: exclusion.fields.map((field) => t(`dispatchLabels.field.${field}`)).join(", ") })
    : t(`dispatchLabels.excluded.${exclusion.code}`);
}

/** Phone browsers and browsers without a PDF viewer show an empty frame, so they get a link to the PDF instead. */
export function canPreviewPdfInline(): boolean {
  if (typeof navigator === "undefined") return true;
  if (navigator.pdfViewerEnabled === false) return false;
  return !window.matchMedia?.("(pointer: coarse)").matches;
}

type Loaded = Readonly<{ key: string; outcome: "failed" | Readonly<{ data: CreateDispatchLabelsResponse; url: string | null }> }>;

type Props = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Orders to print, already narrowed by the caller; the server still decides which ones get a label. */
  orderIds: readonly string[];
  /** Set for a single order: it names the title and the downloaded file. */
  orderNumber?: number;
}>;

export function DispatchLabelPrintDialog({ open, onOpenChange, orderIds, orderNumber }: Props) {
  const { t } = useTranslation();
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent ref={setContent} closeLabel={t("dispatchLabels.close")} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{orderNumber !== undefined ? t("dispatchLabels.titleOne", { number: orderNumber }) : `${t("dispatchLabels.titleMany")} · ${t("dispatchLabels.titleManyCount", { count: orderIds.length })}`}</DialogTitle>
        <DialogDescription>{t("dispatchLabels.description")}</DialogDescription>
      </DialogHeader>
      <SelectPortalContainer.Provider value={content}><PrintBody orderIds={orderIds} orderNumber={orderNumber} /></SelectPortalContainer.Provider>
    </DialogContent>
  </Dialog>;
}

/** Mounted only while the dialog is open, so every opening starts again on the default size. */
function PrintBody({ orderIds, orderNumber }: Readonly<{ orderIds: readonly string[]; orderNumber: number | undefined }>) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [size, setSize] = useState<DispatchLabelSize>(defaultSize);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [inline] = useState(canPreviewPdfInline);
  const ids = orderIds.join(",");
  const key = `${ids}|${size}|${attempt}`;
  const current = loaded?.key === key ? loaded.outcome : null;

  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    void requestDispatchLabels({ orderIds: ids.split(","), size }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.success) return setLoaded({ key, outcome: "failed" });
      url = result.data.pdf ? URL.createObjectURL(pdfBlobFromBase64(result.data.pdf)) : null;
      setLoaded({ key, outcome: { data: result.data, url } });
    });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [key, ids, size]);

  const ready = current && current !== "failed" ? current : null;
  const download = () => {
    if (!ready?.url) return;
    const link = document.createElement("a");
    link.href = ready.url;
    link.download = orderNumber !== undefined ? `rotulo-pedido-${orderNumber}.pdf`
      : `rotulos-${new Date().toLocaleDateString("en-CA", { timeZone: salesTimeZone })}.pdf`;
    link.click();
  };
  const print = () => {
    if (!ready?.url) return;
    if (!inline) { window.open(ready.url, "_blank", "noopener"); return; }
    try { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }
    catch { window.open(ready.url, "_blank", "noopener"); }
  };
  const sizeItems = dispatchLabelSizes.map((value) => ({ value, label: t(`dispatchLabels.size_${value}`) }));
  const notPrinted = ready ? [
    ...ready.data.excluded.map((item) => ({ key: item.orderId, number: item.orderNumber, reason: exclusionText(t, item.exclusion) })),
    ...ready.data.notFound.map((id) => ({ key: id, number: null, reason: t("dispatchLabels.notFound") })),
  ] : [];

  return <>
    <div className="flex min-w-0 flex-col gap-3">
      {current === null && <p role="status" className="flex h-64 items-center justify-center rounded-[var(--radius-card)] border bg-muted/30 text-sm text-muted-foreground">{t("dispatchLabels.loading")}</p>}
      {current === "failed" && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        {t("dispatchLabels.error")}<Button type="button" variant="outline" onClick={() => setAttempt(attempt + 1)}>{t("dispatchLabels.retry")}</Button></AlertDescription></Alert>}
      {ready?.url && !inline && <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border bg-muted/30 p-4 text-sm">
        <p>{t("dispatchLabels.noInlinePreview")}</p>
        <Button asChild variant="outline"><a href={ready.url} target="_blank" rel="noreferrer">{t("dispatchLabels.openPdf")}</a></Button>
      </div>}
      {ready?.url && inline && <figure className="flex flex-col gap-2">
        <iframe ref={frame} src={ready.url} title={t("dispatchLabels.previewTitle")} className="h-[min(42dvh,24rem)] w-full rounded-[var(--radius-card)] border bg-muted/30" />
        <figcaption className="text-center text-xs text-muted-foreground">{t(`dispatchLabels.preview_${ready.data.size}`)}</figcaption>
      </figure>}
      {ready && !ready.url && <p className="text-sm text-muted-foreground">{t("dispatchLabels.nothingPrintable")}</p>}
      {notPrinted.length > 0 && <section aria-labelledby="dispatch-not-printed" className="flex flex-col gap-2 rounded-[var(--radius-card)] border p-3 text-sm">
        <h3 id="dispatch-not-printed" className="font-semibold">{t("dispatchLabels.notPrinted")}</h3>
        <ul className="flex flex-col gap-1">{notPrinted.map((item) => <li key={item.key} className="flex flex-wrap gap-x-2">
          {item.number !== null && <strong className="font-medium">{t("dispatchLabels.orderRef", { number: item.number })}</strong>}<span className="text-muted-foreground">{item.reason}</span>
        </li>)}</ul>
      </section>}
    </div>
    <div className="flex flex-col gap-2">
      <Field>
        <FieldLabel htmlFor="dispatch-label-size">{t("dispatchLabels.size")}</FieldLabel>
        <Select items={sizeItems} value={size} onValueChange={(value) => setSize(value as DispatchLabelSize)}>
          <SelectTrigger id="dispatch-label-size"><SelectValue /></SelectTrigger>
          <SelectContent>{sizeItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <p className="text-xs text-muted-foreground">{t("dispatchLabels.sizeHint")}</p>
      <Link to={localizedPath(pathname, "/settings/delivery#sender")} className="w-fit text-xs text-primary underline-offset-4 hover:underline">{t("dispatchLabels.changeSender")}</Link>
    </div>
    <DialogFooter>
      <Button type="button" variant="outline" disabled={!ready?.url} onClick={download}><Download data-icon="inline-start" aria-hidden="true" />{t("dispatchLabels.download")}</Button>
      <Button type="button" disabled={!ready?.url} onClick={print}><Printer data-icon="inline-start" aria-hidden="true" />{t("dispatchLabels.printPdf")}</Button>
    </DialogFooter>
  </>;
}
