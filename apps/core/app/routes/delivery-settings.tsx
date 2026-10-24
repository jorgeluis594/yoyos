import { useState, type ReactNode } from "react";
import { z } from "zod";
import { Store, Truck, Package } from "lucide-react";
import { useClientReady } from "@core/app/use-client-ready";
import { useTranslation } from "react-i18next";
import { isRouteErrorResponse, useFetcher, useLoaderData, type ActionFunctionArgs, type ClientActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { courierCatalogSchema, saveDeliverySettingsSchema, saveDeliveryZonesSchema, type CourierCatalogResponse, type DeliveryZonesResponse, type DeliverySettingsResponse } from "@shared/contracts/delivery-settings";
import { dispatchSenderResponseSchema, type DispatchSenderResponse } from "@shared/contracts/dispatch-sender";
import { privateUserContext } from "@core/app/private-user-context";
import { dispatchSender } from "@core/src/features/dispatch-sender/composition";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { toDeliverySettingsResponse } from "@core/src/features/delivery-settings/presentation/settings-response";
import { toDeliveryZonesResponse } from "@core/src/features/delivery-settings/presentation/zones-response";
import { log } from "@core/src/shared/infrastructure/logger";
import { PageContainer } from "@core/app/components/ui/page-container";
import { PageHeader } from "@core/app/components/ui/page-header";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@core/app/components/ui/field";
import { Card, CardContent } from "@core/app/components/ui/card";
import { Switch } from "@core/app/components/ui/switch";
import { TextLink } from "@core/app/components/ui/text-link";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { DispatchSenderCard } from "@core/app/components/dispatch-sender-card";
import { DeliveryZonesSection, lacksCoverage } from "@core/app/components/delivery-zones-section";
import { useInstantDeliverySettings, type RowSaveState, type SaveTarget } from "@core/app/components/use-instant-delivery-settings";
import { ErrorState } from "@core/app/components/ui/error-state";

export async function loader({ context }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const result = await deliverySettings.get({ companyId: access.company.id, userId: access.user.id });
  if (!result.success) throw new Response("Unable to load delivery settings", { status: result.error.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 500 });
  const catalog = await deliverySettings.getCourierCatalog({ companyId: access.company.id, userId: access.user.id });
  if (!catalog.success) throw new Response("Unable to load courier catalog", { status: catalog.error.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 500 });
  const sender = await dispatchSender.get(access.company.id);
  if (!sender.success) throw new Response("Unable to load dispatch sender", { status: sender.error.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 500 });
  const settings = { ...toDeliverySettingsResponse(result.data), courierCatalog: courierCatalogSchema.parse({ couriers: catalog.data }),
    sender: dispatchSenderResponseSchema.parse(sender.data), companyName: access.company.name };
  if (access.company.country !== "PE") return { ...settings, zones: null };
  const zones = await deliverySettings.getZones({ companyId: access.company.id, userId: access.user.id });
  if (!zones.success) throw new Response("Unable to load delivery zones", { status: 503 });
  return { ...settings, zones: toDeliveryZonesResponse(zones.data) };
}

export async function action({ context, request }: ActionFunctionArgs) {
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return { error: "invalid" as const }; }
  if (typeof raw === "object" && raw !== null && "intent" in raw) {
    const zones = saveDeliveryZonesSchema.extend({ intent: z.literal("zones") }).safeParse(raw);
    if (!zones.success) return { zonesError: { code: "INVALID_INPUT" as const } };
    const access = context.get(privateUserContext);
    const input = { expectedVersion: zones.data.expectedVersion, zones: zones.data.zones };
    try {
      const result = await deliverySettings.saveZones(input, { companyId: access.company.id, userId: access.user.id });
      if (result.success) return { zonesSaved: toDeliveryZonesResponse(result.data) };
      const error = result.error;
      return { zonesError: { code: error.code,
        ...(error.code === "DELIVERY_SETTINGS_CONFLICT" ? { currentVersion: error.currentVersion, reason: error.reason } : {}),
        ...(error.code === "INVALID_DELIVERY_ZONE" || error.code === "INVALID_DELIVERY_OPTION" ? { field: error.field, index: error.index, optionIndex: error.optionIndex } : {}) } };
    } catch (cause) {
      log.error({ event: "delivery_zones_request_failed", operation: "save_delivery_zones", entryPoint: "web_action", userId: access.user.id,
        errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle delivery zones request");
      return { zonesError: { code: "INTERNAL_ERROR" as const } };
    }
  }
  const parsed = saveDeliverySettingsSchema.safeParse(raw);
  if (!parsed.success) return { error: "invalid" as const };
  const access = context.get(privateUserContext);
  try {
    const result = await deliverySettings.save(parsed.data, { companyId: access.company.id, userId: access.user.id });
    if (result.success) return { saved: toDeliverySettingsResponse(result.data) };
    return { error: result.error.code === "DELIVERY_SETTINGS_CONFLICT" ? "conflict" as const
      : result.error.code === "INVALID_DELIVERY_SETTINGS" ? "invalid" as const : "saveError" as const };
  } catch (cause) {
    log.error({ event: "delivery_settings_request_failed", operation: "save_delivery_settings", entryPoint: "web_action", userId: access.user.id,
      errorCode: "INTERNAL_ERROR", err: cause }, "Unable to handle delivery settings request");
    return { error: "saveError" as const };
  }
}

// A lost response is in doubt, not failed: the save may have been applied. Redirects and client errors keep their usual handling.
export async function clientAction({ request, serverAction }: ClientActionFunctionArgs) {
  const zones = await request.clone().json().then((raw: unknown) => typeof raw === "object" && raw !== null && "intent" in raw, () => false);
  try { return await serverAction<typeof action>(); }
  catch (cause) {
    if ((cause instanceof Response && cause.status < 500) || isRouteErrorResponse(cause)) throw cause;
    return zones ? { zonesError: { code: "INTERNAL_ERROR" as const } } : { error: "in_doubt" as const };
  }
}

// A failed save leaves the screen as it is: the conflict notice decides when to reload.
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: { actionResult: unknown; defaultShouldRevalidate: boolean }) {
  return actionResult && typeof actionResult === "object" && ("error" in actionResult || "zonesError" in actionResult) ? false : defaultShouldRevalidate;
}

const pickupMaxLength = { name: 120, address: 500, instructions: 1000 } as const;
type LoadedSettings = DeliverySettingsResponse & { courierCatalog: CourierCatalogResponse; sender: DispatchSenderResponse; companyName: string; zones: DeliveryZonesResponse | null };

function SettingsForm({ loaded }: { loaded: LoadedSettings }) {
  const { t } = useTranslation();
  const ready = useClientReady();
  const zonesFetcher = useFetcher<typeof clientAction>();
  const [lastZonesSaved, setLastZonesSaved] = useState<DeliveryZonesResponse>();
  const [dismissed, setDismissed] = useState<unknown>();
  const zonesSaved = zonesFetcher.data && "zonesSaved" in zonesFetcher.data ? zonesFetcher.data.zonesSaved : undefined;
  if (zonesSaved && zonesSaved !== lastZonesSaved) setLastZonesSaved(zonesSaved);
  const instant = useInstantDeliverySettings({ loaded, zonesSaved: lastZonesSaved, zonesBusy: zonesFetcher.state !== "idle", ready });
  const { settings, rows, checked, draft, activating, busy, conflict, blocker, invalidFields } = instant;
  const zonesBase = loaded.zones && lastZonesSaved && lastZonesSaved.version > loaded.zones.version ? lastZonesSaved : loaded.zones;
  const zonesState = zonesBase && { ...zonesBase, version: settings.version, home: settings.home, agency: settings.agency };
  const reloadAll = async () => { await instant.reload(); setDismissed(zonesFetcher.data); };
  const noCatalog = loaded.courierCatalog.couriers.length === 0;
  const lacks = (method: "home" | "agency") => zonesState !== null && lacksCoverage(method, zonesState, settings.couriers);
  const switchProps = (target: SaveTarget, label: string) => ({ id: `${target}-enabled`, checked: checked[target], "aria-label": label, "aria-describedby": `${target}-description`,
    disabled: busy || conflict || !ready, onCheckedChange: (value: boolean) => instant.toggle(target, value) });
  const coverage = (method: "home" | "agency") => lacks(method) && <FieldDescription>{t(`deliveryZones.missing.${method}`)} <TextLink href="#delivery-zones">{t("deliverySettings.goToZones")}</TextLink></FieldDescription>;
  const showPickup = checked.store || activating || instant.unsaved;
  const zonesError = zonesFetcher.data !== dismissed ? (zonesFetcher.data && "zonesError" in zonesFetcher.data ? zonesFetcher.data.zonesError?.code : undefined) : undefined;
  return <div className="flex flex-col gap-6">
    <Card><CardContent className="p-0"><FieldSet className="gap-0 divide-y divide-border">
      <FieldLegend className="sr-only">{t("deliverySettings.title")}</FieldLegend>
      <MethodRow id="store" icon={Store} title={t("deliverySettings.store")} description={t("deliverySettings.storeScope")}
        control={<Switch {...switchProps("store", t("deliverySettings.enabled"))} />}
        status={<RowStatus state={rows.store} onRetry={() => instant.retry("store")} />}>
        {activating && <FieldDescription>{t("deliverySettings.activateStore")}</FieldDescription>}
        {showPickup ? <FieldGroup>
          {(["name", "address", "instructions"] as const).map(name => {
            const invalid = invalidFields.some(field => field === name);
            return <Field key={name} data-invalid={invalid}>
              <FieldLabel htmlFor={`pickup-${name}`}>{t(`deliverySettings.${name}`)}</FieldLabel>
              <Input id={`pickup-${name}`} value={draft[name]} maxLength={pickupMaxLength[name]} aria-invalid={invalid} aria-describedby={invalid ? `pickup-${name}-error` : undefined}
                onChange={event => instant.changePickup(name, event.target.value)} onBlur={() => instant.blurPickup(name)} />
              {invalid && <FieldError id={`pickup-${name}-error`}>{t("deliverySettings.invalid")}</FieldError>}
            </Field>;
          })}
        </FieldGroup> : settings.store.pickupPoint && <FieldDescription>{t("deliverySettings.storeKept", { name: settings.store.pickupPoint.name, address: settings.store.pickupPoint.address })}</FieldDescription>}
      </MethodRow>
      <MethodRow id="home" icon={Truck} title={t("deliverySettings.home")} description={t("deliverySettings.homeScope")}
        control={<Switch {...switchProps("home", t("deliverySettings.homeEnabled"))} />}
        status={<RowStatus state={rows.home} onRetry={() => instant.retry("home")} />}>
        {coverage("home")}
      </MethodRow>
      <MethodRow id="agency" icon={Package} title={t("deliverySettings.agency")} description={t("deliverySettings.agencyScope")}
        control={<Switch {...switchProps("agency", t("deliverySettings.agencyEnabled"))} />}
        status={<RowStatus state={rows.agency} onRetry={() => instant.retry("agency")} />}>
        {settings.agency.enabled && <FieldDescription>{t(noCatalog ? "deliveryZones.noCatalog" : "deliverySettings.agencyHowTo")}</FieldDescription>}
        {!noCatalog && coverage("agency")}
      </MethodRow>
      {(checked.home || checked.agency) && zonesState && <div className="p-4"><p className="text-sm text-muted-foreground">{t("deliverySettings.ratesByZone")} <TextLink href="#delivery-zones">{t("deliverySettings.goToZones")}</TextLink></p></div>}
    </FieldSet></CardContent></Card>
    <DispatchSenderCard sender={loaded.sender} companyName={loaded.companyName} />
    {conflict && <Alert variant="destructive"><AlertDescription>{t("deliverySettings.conflict")}</AlertDescription>
      <Button type="button" variant="outline" className="mt-3 max-sm:w-full max-md:min-h-touch" onClick={() => void reloadAll()}>{t("deliverySettings.reload")}</Button></Alert>}
    <Dialog open={blocker.state === "blocked"} onOpenChange={open => { if (!open && blocker.state === "blocked") blocker.reset(); }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{t("deliverySettings.leave")}</DialogTitle></DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => blocker.state === "blocked" && blocker.proceed()}>{t("deliverySettings.leaveConfirm")}</Button>
          <Button onClick={() => blocker.state === "blocked" && blocker.reset()}>{t("deliverySettings.leaveStay")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {zonesState && <DeliveryZonesSection state={zonesState} couriers={settings.couriers} catalog={loaded.courierCatalog.couriers}
      pending={busy || !ready} error={zonesError} saved={lastZonesSaved} onReload={() => void reloadAll()}
      onSave={request => zonesFetcher.submit({ intent: "zones", ...request }, { method: "post", encType: "application/json" })} />}
  </div>;
}

/** The save state of one method, under its description. */
function RowStatus({ state, onRetry }: Readonly<{ state: RowSaveState; onRetry: () => void }>) {
  const { t } = useTranslation();
  if (state.kind === "saving") return <FieldDescription role="status">{t("deliverySettings.saving")}</FieldDescription>;
  if (state.kind === "saved") return <FieldDescription role="status">{t("deliverySettings.rowSaved")}</FieldDescription>;
  if (state.kind !== "failed") return null;
  return <Alert variant="destructive"><AlertDescription>{t(state.reason === "in_doubt" ? "deliverySettings.inDoubt" : "deliverySettings.notSent")}</AlertDescription>
    <Button type="button" variant="outline" className="mt-3 max-md:min-h-touch" onClick={onRetry}>{t("deliverySettings.retrySave")}</Button></Alert>;
}

/** One delivery method: its switch in the header, its settings revealed below while it is offered. */
function MethodRow({ id, icon: Icon, title, description, control, status, children }: Readonly<{
  id: string; icon: typeof Store; title: string; description: string; control: ReactNode; status?: ReactNode; children?: ReactNode;
}>) {
  return <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-4 p-4">
    <div className="flex items-start gap-3">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id={`${id}-title`} className="font-semibold leading-snug"><label htmlFor={`${id}-enabled`} className="cursor-pointer">{title}</label></h2>
        <p id={`${id}-description`} className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex min-h-6 items-center">{control}</div>
    </div>
    <div className="flex min-w-0 flex-col gap-4 empty:hidden sm:pl-7">{status}{children}</div>
  </section>;
}

export default function DeliverySettings() {
  const { t } = useTranslation();
  const settings = useLoaderData<typeof loader>();
  return <PageContainer width="form" className="flex flex-col gap-6"><PageHeader><PageHeader.Heading>
    <PageHeader.Title>{t("deliverySettings.title")}</PageHeader.Title><PageHeader.Description>{t("deliverySettings.description")}</PageHeader.Description>
  </PageHeader.Heading></PageHeader><SettingsForm loaded={settings} /></PageContainer>;
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return <ErrorState title={t("deliverySettings.loadError")} description={t("common.retry")} action={<Button asChild variant="outline"><a href="">{t("deliverySettings.reload")}</a></Button>} />;
}
