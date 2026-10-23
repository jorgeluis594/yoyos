import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFetcher, useLocation, useRevalidator } from "react-router";
import { Alert } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent } from "@core/app/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { Switch } from "@core/app/components/ui/switch";
import { catalogPublicationAnchor, type EditorActionResult, type PublicationPart } from "@core/app/components/store-appearance-editor-actions";
import { useCatalogLink, type CatalogLink } from "@core/app/lib/use-catalog-link";

function submittedValue(json: unknown): boolean | undefined {
  return typeof json === "object" && json !== null && "published" in json && typeof json.published === "boolean" ? json.published : undefined;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const reasonKeys = {
  contains_domain: "catalogLink.reason.contains_domain", contains_space: "catalogLink.reason.contains_space", invalid_character: "catalogLink.reason.invalid_character",
  too_long: "catalogLink.reason.too_long", hyphen_edge: "catalogLink.reason.hyphen_edge", double_hyphen: "catalogLink.reason.double_hyphen", too_short: "catalogLink.reason.too_short",
} as const;

/** The status line text, and whether it is a final verdict that screen readers announce. */
function statusMessage(t: Translate, link: CatalogLink): Readonly<{ text: string; final: boolean; success: boolean }> {
  const address = `${link.value}.${link.settings.domain}`;
  const { status, phase } = link;
  const notSaved = link.notSaved ? `${t("catalogLink.notSaved")} ` : "";
  if (phase === "in_doubt") return { text: t("catalogLink.inDoubt"), final: true, success: false };
  if (phase === "reread_failed") return { text: t("catalogLink.inDoubtFailed"), final: true, success: false };
  if (phase === "rejected") return { text: t("catalogLink.saveRejected"), final: true, success: false };
  if (phase === "save_failed") return { text: t("catalogLink.saveFailed"), final: true, success: false };
  switch (status.kind) {
    case "help": return { text: notSaved + t("catalogLink.help"), final: false, success: false };
    case "checking": return { text: notSaved + t("catalogLink.checking"), final: false, success: false };
    case "invalid": return { text: notSaved + t(reasonKeys[status.reason], { domain: link.settings.domain }), final: true, success: false };
    case "reserved": return { text: notSaved + t("catalogLink.reserved"), final: true, success: false };
    case "in_use": return { text: notSaved + t(status.raced ? "catalogLink.taken" : "catalogLink.inUse", { address }), final: true, success: false };
    case "available": return { text: notSaved + t("catalogLink.available", { address }), final: true, success: true };
    case "check_failed": return { text: notSaved + t("catalogLink.checkFailed"), final: true, success: false };
    case "saved": return { text: t("catalogLink.saved"), final: true, success: true };
    case "current": return { text: t("catalogLink.current"), final: false, success: true };
  }
}

/**
 * Chooses the catalog link and publishes or hides the catalog. The link saves with its own button through a plain fetch,
 * and the switch saves at once through the action of the route that renders the card. Both sit outside the appearance
 * draft, so saving, discarding and leaving the editor never involve them.
 */
export function CatalogPublicationCard({ publication, onLinkUnsavedChange }: Readonly<{ publication: PublicationPart; onLinkUnsavedChange?: (unsaved: boolean) => void }>) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();

  if (publication.kind === "failed") return <Card id={catalogPublicationAnchor}><CardContent>
    <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">{t("catalogSettings.loadError")}
      <Button type="button" size="sm" variant="outline" disabled={revalidator.state !== "idle"} onClick={() => void revalidator.revalidate()}>{t("catalogSettings.retry")}</Button></Alert>
  </CardContent></Card>;

  return <LoadedCard settings={publication} onLinkUnsavedChange={onLinkUnsavedChange} />;
}

function LoadedCard({ settings, onLinkUnsavedChange }: Readonly<{ settings: Extract<PublicationPart, { kind: "loaded" }>; onLinkUnsavedChange?: (unsaved: boolean) => void }>) {
  const { t } = useTranslation();
  const fetcher = useFetcher<EditorActionResult>();
  const { hash } = useLocation();
  const link = useCatalogLink(settings);
  const [confirmHide, setConfirmHide] = useState(false);
  const [copied, setCopied] = useState(false);
  // The last value this card saved: the loader is not read again after a publication change.
  const [known, setKnown] = useState<boolean | null>(null);
  // A newer settings answer makes an older publication result stale.
  const [seenSettings, setSeenSettings] = useState(link.settings);
  const [dismissed, setDismissed] = useState<EditorActionResult | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const keepCurrent = useRef(false);

  const idle = fetcher.state === "idle";
  if (link.settings !== seenSettings) { setSeenSettings(link.settings); setKnown(null); setDismissed(fetcher.data); }
  const result = idle && fetcher.data !== dismissed ? fetcher.data : undefined;
  const confirmed = result && "published" in result ? result.published : null;
  if (confirmed !== null && confirmed !== known) setKnown(confirmed);
  // While saving the switch shows the requested value; on failure it returns to the previous one.
  const published = (idle ? undefined : submittedValue(fetcher.json)) ?? known ?? link.settings.published;
  const failed = !!result && "error" in result;
  const needsLink = failed && "reason" in result && result.reason === "subdomain_required";
  const save = (value: boolean) => void fetcher.submit({ intent: "set-publication", published: value }, { method: "post", encType: "application/json" });

  const { unsaved, focusTarget, busy, clearFocus } = link;
  useEffect(() => { onLinkUnsavedChange?.(unsaved); }, [unsaved, onLinkUnsavedChange]);
  useEffect(() => () => onLinkUnsavedChange?.(false), [onLinkUnsavedChange]);
  useEffect(() => { if (hash === `#${catalogPublicationAnchor}`) cardRef.current?.scrollIntoView?.(); }, [hash]);
  useEffect(() => {
    if (!focusTarget || busy) return;
    const button = saveRef.current;
    (focusTarget === "button" && button && !button.disabled ? button : fieldRef.current)?.focus();
    clearFocus();
  }, [focusTarget, busy, clearFocus]);

  const status = statusMessage(t as Translate, link);
  const address = link.settings.subdomain ? `${link.settings.subdomain}.${link.settings.domain}` : "";
  const noLink = link.settings.subdomain === null;
  const copy = async () => {
    if (!link.settings.url) return;
    try { await navigator.clipboard.writeText(link.settings.url); setCopied(true); } catch { setCopied(false); }
  };

  return <Card id={catalogPublicationAnchor} ref={cardRef}><CardContent className="flex flex-col gap-5">
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="catalog-subdomain">{t("catalogLink.label")}</FieldLabel>
        <div className="flex items-center gap-2">
          <Input id="catalog-subdomain" ref={fieldRef} value={link.value} disabled={link.busy} autoComplete="off" autoCapitalize="none" spellCheck={false}
            aria-describedby="catalog-subdomain-suffix catalog-subdomain-status" className="min-w-0 flex-1"
            onChange={(event) => link.edit(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); link.save(); } }} />
          <span id="catalog-subdomain-suffix" className="shrink-0 text-sm text-muted-foreground">.{link.settings.domain}</span>
        </div>
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <p id="catalog-subdomain-status" className="flex items-center gap-1.5 text-sm">
          {status.success && <Check className="size-4 text-[var(--success)]" aria-hidden="true" />}{status.text}
        </p>
        {link.status.kind === "check_failed" && link.phase === "idle" && <Button type="button" size="sm" variant="outline" onClick={link.retryCheck}>{t("catalogLink.retry")}</Button>}
        {(link.phase === "save_failed" || link.phase === "rejected" || link.phase === "reread_failed") && <Button type="button" size="sm" variant="outline" onClick={link.retrySave}>{t("catalogLink.retry")}</Button>}
      </div>
      <div className="sr-only" aria-live="polite">{status.final ? status.text : ""}</div>
      <div className="flex flex-col items-start gap-1">
        <Button type="button" ref={saveRef} variant="secondary" className="min-h-touch" disabled={!link.canSave} onClick={link.save}>
          {link.phase === "saving" ? t("catalogLink.saving") : t("catalogLink.save")}</Button>
        <p className="text-xs text-muted-foreground">{t("catalogLink.saveHint")}</p>
      </div>
      {!noLink && <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 break-all text-sm">{t("catalogLink.yourLink")}: {link.settings.url}</p>
        {(known ?? link.settings.published) && <>
          <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>{t("catalogSettings.copy")}</Button>
          <Button asChild size="sm" variant="outline"><a href={link.settings.url ?? undefined} target="_blank" rel="noreferrer">{t("catalogSettings.view")}</a></Button>
        </>}
      </div>}
      <div aria-live="polite">{copied && <Alert variant="success">{t("catalogSettings.copied")}</Alert>}</div>
    </div>

    <div className="flex flex-col gap-4 border-t pt-5">
      <Field orientation="horizontal">
        <Switch id="catalog-published" checked={published} disabled={!idle || noLink || link.busy}
          aria-describedby={noLink ? "catalog-publish-needs-link" : undefined}
          onCheckedChange={(checked) => checked ? save(true) : setConfirmHide(true)} />
        <div className="flex flex-col gap-1"><FieldLabel htmlFor="catalog-published">{t("catalogSettings.publish")}</FieldLabel>
          <FieldDescription>{t("catalogSettings.publishHint")}</FieldDescription>
          <FieldDescription>{t("catalogSettings.savedInstantly")}</FieldDescription>
          {noLink && <FieldDescription id="catalog-publish-needs-link">{t("catalogLink.subdomainRequired")}</FieldDescription>}</div>
      </Field>
      <div aria-live="polite">
        {needsLink && <Alert variant="destructive">{t("catalogLink.subdomainRequired")}</Alert>}
        {failed && !needsLink && <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">{t("catalogSettings.saveError")}
          <Button type="button" size="sm" variant="outline" onClick={() => save(!published)}>{t("catalogSettings.retry")}</Button></Alert>}
        {!failed && result && "published" in result && <Alert variant="success">{t(result.published ? "catalogSettings.published" : "catalogSettings.hidden")}</Alert>}
      </div>
    </div>

    <Dialog open={confirmHide} onOpenChange={setConfirmHide}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("catalogSettings.hideTitle")}</DialogTitle>
          <DialogDescription>{t("catalogSettings.hideDescription")}</DialogDescription></DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">{t("catalogSettings.keepPublished")}</Button></DialogClose>
          <Button variant="destructive" onClick={() => { setConfirmHide(false); save(false); }}>{t("catalogSettings.hide")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={link.asking} onOpenChange={(open) => { if (!open) { keepCurrent.current = true; link.cancelChange(); } }}>
      {/* Focus goes where the product says: back to Guardar link when nothing was saved, and to the field after a saved change. */}
      <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); if (keepCurrent.current) saveRef.current?.focus(); keepCurrent.current = false; }}>
        <DialogHeader><DialogTitle>{t("catalogLink.changeTitle")}</DialogTitle>
          <DialogDescription>{t("catalogLink.changeDescription", { address })}</DialogDescription></DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">{t("catalogLink.keepCurrent")}</Button></DialogClose>
          <Button variant="destructive" onClick={() => { keepCurrent.current = false; link.confirmChange(); }}>{t("catalogLink.change")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </CardContent></Card>;
}
