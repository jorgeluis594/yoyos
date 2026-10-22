import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher, useRevalidator } from "react-router";
import { Alert } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent } from "@core/app/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@core/app/components/ui/field";
import { Switch } from "@core/app/components/ui/switch";
import type { EditorActionResult, PublicationPart } from "@core/app/components/store-appearance-editor-actions";

function submittedValue(json: unknown): boolean | undefined {
  return typeof json === "object" && json !== null && "published" in json && typeof json.published === "boolean" ? json.published : undefined;
}

/**
 * Publishes or hides the catalog at once. It posts to the action of the route that renders it and sits outside
 * the appearance draft, so saving, discarding and leaving the editor never involve it.
 */
export function CatalogPublicationCard({ publication }: Readonly<{ publication: PublicationPart }>) {
  const { t } = useTranslation();
  const fetcher = useFetcher<EditorActionResult>();
  const revalidator = useRevalidator();
  const [confirmHide, setConfirmHide] = useState(false);
  // The last value this card saved: the loader is not read again after a publication change.
  const [known, setKnown] = useState<boolean | null>(null);

  if (publication.kind === "failed") return <Card><CardContent>
    <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">{t("catalogSettings.loadError")}
      <Button type="button" size="sm" variant="outline" disabled={revalidator.state !== "idle"} onClick={() => void revalidator.revalidate()}>{t("catalogSettings.retry")}</Button></Alert>
  </CardContent></Card>;

  const idle = fetcher.state === "idle";
  const result = idle ? fetcher.data : undefined;
  const confirmed = result && "published" in result ? result.published : null;
  if (confirmed !== null && confirmed !== known) setKnown(confirmed);
  // While saving the switch shows the requested value; on failure it returns to the previous one.
  const published = (idle ? undefined : submittedValue(fetcher.json)) ?? known ?? publication.published;
  const failed = !!result && "error" in result;
  const save = (value: boolean) => void fetcher.submit({ intent: "set-publication", published: value }, { method: "post", encType: "application/json" });

  return <Card><CardContent className="flex flex-col gap-4">
    <Field orientation="horizontal">
      <Switch id="catalog-published" checked={published} disabled={!idle}
        onCheckedChange={(checked) => checked ? save(true) : setConfirmHide(true)} />
      <div className="flex flex-col gap-1"><FieldLabel htmlFor="catalog-published">{t("catalogSettings.publish")}</FieldLabel>
        <FieldDescription>{t("catalogSettings.publishHint")}</FieldDescription>
        <FieldDescription>{t("catalogSettings.savedInstantly")}</FieldDescription></div>
    </Field>
    <div aria-live="polite">
      {failed && <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">{t("catalogSettings.saveError")}
        <Button type="button" size="sm" variant="outline" onClick={() => save(!published)}>{t("catalogSettings.retry")}</Button></Alert>}
      {!failed && result && "published" in result && <Alert variant="success">{t(result.published ? "catalogSettings.published" : "catalogSettings.hidden")}</Alert>}
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
  </CardContent></Card>;
}
