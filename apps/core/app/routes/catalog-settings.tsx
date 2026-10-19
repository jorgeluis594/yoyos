import { useState } from "react";
import { useTranslation } from "react-i18next";
import { data, isRouteErrorResponse, useFetcher, useLoaderData, type ActionFunctionArgs, type ClientActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { privateUserContext } from "@core/app/private-user-context";
import { Alert } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent } from "@core/app/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { ErrorState } from "@core/app/components/ui/error-state";
import { Field, FieldDescription, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { PageHeader } from "@core/app/components/ui/page-header";
import { Switch } from "@core/app/components/ui/switch";
import { catalogSettings, toCatalogSettingsResponse, type CatalogSettingsAccess } from "@core/src/features/catalog";

function accessOf(context: LoaderFunctionArgs["context"]) {
  const access = context.get(privateUserContext);
  return { companyId: access.company.id, userId: access.user.id } as CatalogSettingsAccess;
}

export async function loader({ context }: LoaderFunctionArgs) {
  const access = accessOf(context);
  const result = await catalogSettings.get(access);
  if (!result.success) throw new Response("Catalog settings unavailable", { status: 503 });
  return toCatalogSettingsResponse(result.data, access.companyId);
}

const publishedField = z.enum(["true", "false"]).transform(value => value === "true");

export async function action({ context, request }: ActionFunctionArgs) {
  const parsed = publishedField.safeParse((await request.formData()).get("published"));
  if (!parsed.success) return data({ error: true as const }, { status: 400 });
  const result = await catalogSettings.setPublication(parsed.data, accessOf(context));
  return result.success ? { published: result.data.published } : data({ error: true as const }, { status: 503 });
}

// A lost request shows the save error instead of replacing the page with the load error.
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try { return await serverAction<typeof action>(); }
  catch (cause) {
    if (cause instanceof Response || isRouteErrorResponse(cause)) throw cause;
    return { error: true as const };
  }
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return <ErrorState title={t("catalogSettings.loadError")}
    action={<Button onClick={() => window.location.reload()}>{t("catalogSettings.retry")}</Button>} />;
}

export default function CatalogSettings() {
  const { t } = useTranslation();
  const settings = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof clientAction>();
  const [confirmHide, setConfirmHide] = useState(false);
  const [copied, setCopied] = useState(false);
  const submitted = fetcher.formData?.get("published");
  // On failure the loader data is unchanged, so the switch returns to its previous position.
  const published = submitted === undefined || submitted === null ? settings.published : submitted === "true";
  const failed = fetcher.state === "idle" && fetcher.data !== undefined && "error" in fetcher.data;
  const save = (value: boolean) => { setCopied(false); void fetcher.submit({ published: String(value) }, { method: "post" }); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(settings.url); setCopied(true); } catch { setCopied(false); }
  };

  return <div className="flex flex-col gap-6">
    <PageHeader><PageHeader.Heading><PageHeader.Title>{t("catalogSettings.title")}</PageHeader.Title>
      <PageHeader.Description>{t("catalogSettings.description")}</PageHeader.Description></PageHeader.Heading></PageHeader>
    <Card><CardContent className="flex flex-col gap-5">
      <Field orientation="horizontal">
        <Switch id="catalog-published" checked={published} disabled={fetcher.state !== "idle"}
          onCheckedChange={(checked) => checked ? save(true) : setConfirmHide(true)} />
        <div className="flex flex-col gap-1"><FieldLabel htmlFor="catalog-published">{t("catalogSettings.publish")}</FieldLabel>
          <FieldDescription>{t("catalogSettings.publishHint")}</FieldDescription></div>
      </Field>
      {published && <Field>
        <FieldLabel htmlFor="catalog-url">{t("catalogSettings.link")}</FieldLabel>
        <Input id="catalog-url" value={settings.url} readOnly onFocus={(event) => event.currentTarget.select()} />
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void copy()}>{t("catalogSettings.copy")}</Button>
          <Button asChild variant="outline"><a href={settings.url} target="_blank" rel="noreferrer">{t("catalogSettings.view")}</a></Button>
        </div>
      </Field>}
      <div aria-live="polite">
        {failed && <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">{t("catalogSettings.saveError")}
          <Button type="button" size="sm" variant="outline" onClick={() => save(!settings.published)}>{t("catalogSettings.retry")}</Button></Alert>}
        {!failed && copied && <Alert variant="success">{t("catalogSettings.copied")}</Alert>}
        {!failed && !copied && fetcher.state === "idle" && fetcher.data && "published" in fetcher.data
          && <Alert variant="success">{t(fetcher.data.published ? "catalogSettings.published" : "catalogSettings.hidden")}</Alert>}
      </div>
    </CardContent></Card>
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
  </div>;
}
