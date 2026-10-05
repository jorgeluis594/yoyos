import { useState } from "react";
import { useClientReady } from "@core/app/use-client-ready";
import { useTranslation } from "react-i18next";
import { useActionData, useLoaderData, useNavigation, useSubmit, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { deliverySettingsSchema, saveDeliverySettingsSchema, type DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { privateUserContext } from "@core/app/private-user-context";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { log } from "@core/src/shared/infrastructure/logger";
import { PageContainer } from "@core/app/components/ui/page-container";
import { PageHeader } from "@core/app/components/ui/page-header";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { ErrorState } from "@core/app/components/ui/error-state";

export async function loader({ context }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const result = await deliverySettings.get({ companyId: access.company.id, userId: access.user.id });
  if (!result.success) throw new Response("Unable to load delivery settings", { status: result.error.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 500 });
  return deliverySettingsSchema.parse(result.data);
}

export async function action({ context, request }: ActionFunctionArgs) {
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return { error: "invalid" as const }; }
  const parsed = saveDeliverySettingsSchema.safeParse(raw);
  if (!parsed.success) return { error: "invalid" as const };
  const access = context.get(privateUserContext);
  try {
    const result = await deliverySettings.save(parsed.data, { companyId: access.company.id, userId: access.user.id });
    if (result.success) return { saved: deliverySettingsSchema.parse(result.data) };
    return { error: result.error.code === "DELIVERY_SETTINGS_CONFLICT" ? "conflict" as const
      : result.error.code === "INVALID_DELIVERY_SETTINGS" ? "invalid" as const : "saveError" as const };
  } catch (cause) {
    log.error({ event: "delivery_settings_request_failed", operation: "save_delivery_settings", entryPoint: "web", userId: access.user.id,
      errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle delivery settings request");
    return { error: "saveError" as const };
  }
}

function SettingsForm({ settings }: { settings: DeliverySettingsResponse }) {
  const { t } = useTranslation();
  const submit = useSubmit();
  const ready = useClientReady();
  const navigation = useNavigation();
  const result = useActionData<typeof action>();
  const [version, setVersion] = useState(settings.version);
  const [homeEnabled, setHomeEnabled] = useState(settings.home.enabled);
  const [enabled, setEnabled] = useState(settings.store.enabled);
  const [name, setName] = useState(settings.store.pickupPoint?.name ?? "");
  const [address, setAddress] = useState(settings.store.pickupPoint?.address ?? "");
  const [instructions, setInstructions] = useState(settings.store.pickupPoint?.instructions ?? "");
  const saved = result?.saved;
  // Only a confirmed save replaces the draft; loader revalidation preserves it.
  if (saved && saved.version !== version) {
    setVersion(saved.version);
    setHomeEnabled(saved.home.enabled);
    setEnabled(saved.store.enabled);
    setName(saved.store.pickupPoint?.name ?? "");
    setAddress(saved.store.pickupPoint?.address ?? "");
    setInstructions(saved.store.pickupPoint?.instructions ?? "");
  }
  const pending = navigation.state !== "idle";
  const conflict = result?.error === "conflict";
  const configured = enabled || [name, address, instructions].some(value => value.trim() !== "");
  return <form className="flex flex-col gap-6" onSubmit={event => {
    event.preventDefault();
    if (!ready) return;
    submit({ expectedVersion: version, home: { enabled: homeEnabled }, store: { enabled, pickupPoint: configured
      ? { name, address, instructions: instructions.trim() || null } : null } }, { method: "post", encType: "application/json" });
  }}>
    <fieldset className="flex min-w-0 flex-col gap-4" disabled={pending || !ready}>
      <legend className="mb-3 text-lg font-semibold">{t("deliverySettings.store")}</legend>
      <label className="flex min-h-touch items-center gap-3"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{t("deliverySettings.enabled")}</label>
      <p className="text-sm text-muted-foreground">{t("deliverySettings.storeHint")}</p>
      <Field><FieldLabel htmlFor="pickup-name">{t("deliverySettings.name")}</FieldLabel><Input id="pickup-name" value={name} maxLength={120} required={configured} onChange={event => setName(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="pickup-address">{t("deliverySettings.address")}</FieldLabel><Input id="pickup-address" value={address} maxLength={500} required={configured} onChange={event => setAddress(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="pickup-instructions">{t("deliverySettings.instructions")}</FieldLabel><Input id="pickup-instructions" value={instructions} maxLength={1000} onChange={event => setInstructions(event.target.value)} /></Field>
    </fieldset>
    <fieldset className="flex min-w-0 flex-col gap-4" disabled={pending || !ready}>
      <legend className="mb-3 text-lg font-semibold">{t("deliverySettings.home")}</legend>
      <label className="flex min-h-touch items-center gap-3"><input type="checkbox" checked={homeEnabled} onChange={event => setHomeEnabled(event.target.checked)} />{t("deliverySettings.homeEnabled")}</label>
    </fieldset>
    {result?.error && <p role="alert" className="text-sm text-destructive">{t(`deliverySettings.${result.error}`)}</p>}
    {result?.saved && <p role="status">{t("deliverySettings.saved")}</p>}
    <div className="flex flex-wrap gap-3"><Button type="submit" disabled={pending || !ready || Boolean(conflict)}>{t(pending ? "deliverySettings.saving" : "deliverySettings.save")}</Button>
      {conflict && <Button asChild variant="outline"><a href="">{t("deliverySettings.reload")}</a></Button>}</div>
  </form>;
}

export default function DeliverySettings() {
  const { t } = useTranslation();
  const settings = useLoaderData<typeof loader>();
  return <PageContainer width="form" className="flex flex-col gap-6"><PageHeader><PageHeader.Heading>
    <PageHeader.Title>{t("deliverySettings.title")}</PageHeader.Title><PageHeader.Description>{t("deliverySettings.description")}</PageHeader.Description>
  </PageHeader.Heading></PageHeader><SettingsForm settings={settings} /></PageContainer>;
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return <ErrorState title={t("deliverySettings.loadError")} description={t("common.retry")} action={<Button asChild variant="outline"><a href="">{t("deliverySettings.reload")}</a></Button>} />;
}
