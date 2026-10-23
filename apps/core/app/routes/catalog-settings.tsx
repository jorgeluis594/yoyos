import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLoaderData, useLocation, type LoaderFunctionArgs } from "react-router";
import { localizedPath } from "@core/app/locale";
import { privateUserContext } from "@core/app/private-user-context";
import { Alert } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent } from "@core/app/components/ui/card";
import { ErrorState } from "@core/app/components/ui/error-state";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { PageHeader } from "@core/app/components/ui/page-header";
import { catalogPublicationAnchor } from "@core/app/components/store-appearance-editor-actions";
import { catalogSettings, toCatalogSettingsResponse, type CatalogSettingsAccess } from "@core/src/features/catalog";

function accessOf(context: LoaderFunctionArgs["context"]) {
  const access = context.get(privateUserContext);
  return { companyId: access.company.id, userId: access.user.id } as CatalogSettingsAccess;
}

export async function loader({ context }: LoaderFunctionArgs) {
  const access = accessOf(context);
  const result = await catalogSettings.get(access);
  if (!result.success) throw new Response("Catalog settings unavailable", { status: 503 });
  return toCatalogSettingsResponse(result.data);
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return <ErrorState title={t("catalogSettings.loadError")}
    action={<Button onClick={() => window.location.reload()}>{t("catalogSettings.retry")}</Button>} />;
}

export default function CatalogSettings() {
  const { t } = useTranslation();
  const settings = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const [copied, setCopied] = useState(false);
  const { url } = settings;
  const copy = async () => {
    if (url === null) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  };

  const link = settings.published ? url : null;
  const notice = settings.published ? "catalogSettings.hideFromAppearance" : settings.subdomain ? "catalogSettings.hiddenNotice" : "catalogSettings.hiddenNoLinkNotice";

  return <div className="flex flex-col gap-6">
    <PageHeader><PageHeader.Heading><PageHeader.Title>{t("catalogSettings.title")}</PageHeader.Title>
      <PageHeader.Description>{t("catalogSettings.description")}</PageHeader.Description></PageHeader.Heading></PageHeader>
    <Card><CardContent className="flex flex-col gap-5">
      {link !== null && <Field>
        <FieldLabel htmlFor="catalog-url">{t("catalogSettings.link")}</FieldLabel>
        <p id="catalog-url" className="break-all text-sm select-all">{link}</p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void copy()}>{t("catalogSettings.copy")}</Button>
          <Button asChild variant="outline"><a href={link} target="_blank" rel="noreferrer">{t("catalogSettings.view")}</a></Button>
        </div>
      </Field>}
      <div aria-live="polite">{copied && <Alert variant="success">{t("catalogSettings.copied")}</Alert>}</div>
      <p className="text-sm text-muted-foreground">{t(notice)}</p>
      <div><Button asChild variant="outline"><Link to={`${localizedPath(pathname, "/settings/store-appearance")}#${catalogPublicationAnchor}`}>{t("catalogSettings.goToAppearance")}</Link></Button></div>
    </CardContent></Card>
  </div>;
}
