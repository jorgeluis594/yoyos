import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Copy, ExternalLink } from "lucide-react";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@core/app/components/ui/card";
import { Input } from "@core/app/components/ui/input";

/** What the loader could say about the order's link: the brand-host URL, the missing subdomain, or a failed read. */
export type OrderLink =
  | Readonly<{ kind: "ready"; url: string }>
  | Readonly<{ kind: "subdomain_required"; appearancePath: string }>
  | Readonly<{ kind: "unavailable" }>;
export type OrderLinkCardProps = Readonly<{ cancelled: boolean; confirmed: boolean; link: OrderLink }>;

const iconButton = "min-h-control min-w-control max-md:min-h-touch max-md:min-w-touch";

export function OrderLinkCard({ cancelled, confirmed, link }: OrderLinkCardProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  }
  return <Card role="region" aria-labelledby="order-link-title" className="min-w-0 max-xl:order-5">
    <CardHeader><CardTitle id="order-link-title">{t("orderLink.title")}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t(cancelled ? "orderLink.cancelled" : confirmed ? "orderLink.confirmed" : "orderLink.pending")}</p>
      {!cancelled && link.kind === "ready" && <>
        <div className="flex items-center gap-2">
          <Input readOnly value={link.url} aria-label={t("orderLink.label")} className="min-w-0 flex-1 text-ellipsis" onFocus={event => event.target.select()} />
          <Button type="button" variant="outline" size="icon" className={iconButton} aria-label={t("orderLink.copy")} onClick={() => void copy(link.url)}><Copy aria-hidden="true" /></Button>
          <Button asChild variant="outline" size="icon" className={iconButton}>
            <a href={link.url} target="_blank" rel="noopener noreferrer" aria-label={t("orderLink.open")}><ExternalLink aria-hidden="true" /></a>
          </Button>
        </div>
        <div aria-live="polite" className="text-sm">{copied ? t("orderLink.copied") : ""}</div>
        <p className="text-sm text-muted-foreground">{t("orderLink.help")}</p>
      </>}
      {!cancelled && link.kind === "subdomain_required" && <>
        <p className="text-sm">{t("orderLink.subdomainRequired")}</p>
        <Button asChild variant="outline" className="min-h-control w-fit max-md:min-h-touch"><Link to={link.appearancePath}>{t("orderLink.goToAppearance")}</Link></Button>
      </>}
      {!cancelled && link.kind === "unavailable" && <Alert variant="destructive"><AlertDescription>{t("orderLink.unavailable")}</AlertDescription></Alert>}
    </CardContent>
  </Card>;
}
