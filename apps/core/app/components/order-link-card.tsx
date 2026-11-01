import { useEffect, useRef, useState } from "react";
import { Link, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { Copy, ExternalLink, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { Input } from "@core/app/components/ui/input";

/** What the loader could say about the order's link: the brand-host URL, the missing subdomain, or a failed read. */
export type OrderLink =
  | Readonly<{ kind: "ready"; url: string }>
  | Readonly<{ kind: "subdomain_required"; appearancePath: string }>
  | Readonly<{ kind: "unavailable" }>;
/** The buyer's side of the order, with the list's rule: «pending» only describes an order still open, so a completed unconfirmed one has no state line. */
export type OrderLinkState = "pending" | "confirmed" | "cancelled" | null;
/**
 * The seller's review of a chat order, as the card needs it. `gated` hides the URL: the copy and open icons ask for the review first (`onRequest`) and the link is taken
 * on the click after it (`onTaken`). `blocked` keeps the icons `aria-disabled` while product edits are unsaved.
 */
export type OrderLinkReview = Readonly<{
  gated: boolean; counts: string | null; blocked: boolean;
  /** «Mientras revisabas, un mensaje agregó…», announced politely until the next review. */
  statusLine: string | null;
  onRequest: (action: "copy" | "open") => void;
  onTaken: (action: "copy" | "open") => void;
}>;
/** `pendingSave` is the unsaved new sale: the card is grey with disabled controls and ignores `link` and `state`. */
export type OrderLinkCardProps = Readonly<{ state: OrderLinkState; link: OrderLink; pendingSave?: boolean; review?: OrderLinkReview | null }>;
export function orderLinkState(order: Readonly<{ cancelled: boolean; status: string; checkoutConfirmedAt: string | null }>): OrderLinkState {
  if (order.cancelled) return "cancelled";
  if (order.checkoutConfirmedAt) return "confirmed";
  return order.status === "active" ? "pending" : null;
}

const copiedForMs = 3000;

const iconButton = "min-h-control min-w-control max-md:min-h-touch max-md:min-w-touch";

export function OrderLinkCard({ state, link, pendingSave = false, review = null }: OrderLinkCardProps) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // The message clears after a moment so copying again is announced again.
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); } catch { return; }
    review?.onTaken("copy");
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), copiedForMs);
  }
  if (pendingSave) return <PendingSaveCard />;
  const cancelled = state === "cancelled";
  return <Card role="region" aria-labelledby="order-link-title" className="min-w-0 max-xl:order-4">
    <CardHeader><CardTitle id="order-link-title">{t("orderLink.title")}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-3">
      {state && <p className="text-sm text-muted-foreground">{t(`orderLink.${state}`)}</p>}
      {!cancelled && link.kind === "ready" && review?.gated && <GatedLink review={review} />}
      {!cancelled && link.kind === "ready" && !review?.gated && <>
        <div className="flex items-center gap-2">
          <Input readOnly value={link.url} aria-label={t("orderLink.label")} className="min-w-0 flex-1 text-ellipsis" onFocus={event => event.target.select()} />
          <Button id="order-link-copy" type="button" variant="outline" size="icon" className={iconButton} aria-label={t("orderLink.copy")} onClick={() => void copy(link.url)}><Copy aria-hidden="true" /></Button>
          <Button asChild variant="outline" size="icon" className={iconButton}>
            <a id="order-link-open" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={t("orderLink.open")} onClick={() => review?.onTaken("open")}><ExternalLink aria-hidden="true" /></a>
          </Button>
        </div>
        <div className="text-sm">
          <p className="text-muted-foreground">{t("orderLink.help")}</p>
          <p role="status" aria-live="polite">{copied ? t("orderLink.copied") : ""}</p>
        </div>
      </>}
      {!cancelled && link.kind === "ready" && <p role="status" aria-live="polite" className="text-sm empty:hidden">{review?.statusLine ?? ""}</p>}
      {!cancelled && link.kind === "subdomain_required" && <>
        <p className="text-sm">{t("orderLink.subdomainRequired")}</p>
        <Button asChild variant="outline" className="min-h-control w-fit max-md:min-h-touch"><Link to={link.appearancePath}>{t("orderLink.goToAppearance")}</Link></Button>
      </>}
      {!cancelled && link.kind === "unavailable" && <>
        <Alert variant="destructive"><AlertDescription>{t("orderLink.unavailable")}</AlertDescription></Alert>
        <Button type="button" variant="outline" className="min-h-control w-fit max-md:min-h-touch" disabled={revalidator.state !== "idle"} onClick={() => void revalidator.revalidate()}>{t("orderLink.retry")}</Button>
      </>}
    </CardContent>
  </Card>;
}

/** An order with something to review: no URL, only what the review will show, and the icons that ask for it before the link is taken. */
function GatedLink({ review }: Readonly<{ review: OrderLinkReview }>) {
  const { t } = useTranslation();
  const disabled = review.blocked || undefined;
  const describedBy = review.blocked ? "order-link-blocked" : undefined;
  return <>
    <div className="grid gap-1 text-sm">
      <p>{t("orderReview.card.reviewFirst")}</p>
      {review.counts && <p className="font-medium">{review.counts}</p>}
    </div>
    <div className="flex items-center gap-2">
      <Button id="order-link-copy" type="button" variant="outline" size="icon" className={`${iconButton} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`} aria-label={t("orderLink.copy")} aria-disabled={disabled}
        aria-describedby={describedBy} onClick={() => { if (!review.blocked) review.onRequest("copy"); }}><Copy aria-hidden="true" /></Button>
      <Button id="order-link-open" type="button" variant="outline" size="icon" className={`${iconButton} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`} aria-label={t("orderLink.open")} aria-disabled={disabled}
        aria-describedby={describedBy} onClick={() => { if (!review.blocked) review.onRequest("open"); }}><ExternalLink aria-hidden="true" /></Button>
    </div>
    {review.blocked && <p id="order-link-blocked" className="text-sm text-muted-foreground">{t("orderReview.card.blocked")}</p>}
  </>;
}

function PendingSaveCard() {
  const { t } = useTranslation();
  return <Card role="region" aria-labelledby="order-link-title" className="min-w-0 bg-muted/50 max-xl:order-4">
    <CardHeader><CardTitle id="order-link-title">{t("orderLink.title")}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Lock className="size-4 shrink-0" aria-hidden="true" />{t("orderView.link.availableOnSave")}</p>
      <div className="flex items-center gap-2">
        <Input readOnly disabled value="" placeholder="yoyos.pe/p/…" aria-label={t("orderLink.label")} className="min-w-0 flex-1" />
        <Button type="button" variant="outline" size="icon" disabled className={iconButton} aria-label={t("orderLink.copy")}><Copy aria-hidden="true" /></Button>
        <Button type="button" variant="outline" size="icon" disabled className={iconButton} aria-label={t("orderLink.open")}><ExternalLink aria-hidden="true" /></Button>
      </div>
    </CardContent>
  </Card>;
}
