import { useEffect, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { z } from "zod";
import { Store, Truck, Package } from "lucide-react";
import { useClientReady } from "@core/app/use-client-ready";
import { useTranslation } from "react-i18next";
import { useFetcher, useActionData, useLoaderData, useNavigation, useSubmit, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { courierCatalogSchema, saveDeliverySettingsSchema, saveDeliveryZonesSchema, type CourierCatalogResponse, type DeliveryZonesResponse, type DeliverySettingsResponse, type SaveDeliverySettingsRequest } from "@shared/contracts/delivery-settings";
import { privateUserContext } from "@core/app/private-user-context";
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
import { DeliveryZonesSection } from "@core/app/components/delivery-zones-section";
import { ErrorState } from "@core/app/components/ui/error-state";

export async function loader({ context }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const result = await deliverySettings.get({ companyId: access.company.id, userId: access.user.id });
  if (!result.success) throw new Response("Unable to load delivery settings", { status: result.error.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 500 });
  const catalog = await deliverySettings.getCourierCatalog({ companyId: access.company.id, userId: access.user.id });
  if (!catalog.success) throw new Response("Unable to load courier catalog", { status: catalog.error.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 500 });
  const settings = { ...toDeliverySettingsResponse(result.data), courierCatalog: courierCatalogSchema.parse({ couriers: catalog.data }) };
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

const formSchema = z.object({
  version: z.number().int(),
  agencyEnabled: z.boolean(),
  homeEnabled: z.boolean(),
  enabled: z.boolean(),
  name: z.string().max(120),
  address: z.string().max(500),
  instructions: z.string().max(1000),
}).superRefine((values, context) => {
  const configured = values.enabled || [values.name, values.address, values.instructions].some(value => value.trim());
  if (configured) {
    if (!values.name.trim()) context.addIssue({ code: "custom", path: ["name"], message: "required" });
    if (!values.address.trim()) context.addIssue({ code: "custom", path: ["address"], message: "required" });
  }
});
type FormValues = z.infer<typeof formSchema>;

function createDraft(settings: DeliverySettingsResponse): FormValues {
  return {
    version: settings.version,
    agencyEnabled: settings.agency.enabled,
    homeEnabled: settings.home.enabled,
    enabled: settings.store.enabled,
    name: settings.store.pickupPoint?.name ?? "",
    address: settings.store.pickupPoint?.address ?? "",
    instructions: settings.store.pickupPoint?.instructions ?? "",
  };
}

function SettingsForm({ settings }: { settings: DeliverySettingsResponse & { courierCatalog: CourierCatalogResponse; zones: DeliveryZonesResponse | null } }) {
  const { t } = useTranslation();
  const submit = useSubmit();
  const ready = useClientReady();
  const navigation = useNavigation();
  const result = useActionData<typeof action>();
  const zonesFetcher = useFetcher<typeof action>();
  const [zoneHistory, setZoneHistory] = useState<{ state: DeliveryZonesResponse | null; saved?: DeliveryZonesResponse }>({ state: settings.zones });
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: createDraft(settings), shouldFocusError: false });
  const [enabled, homeEnabled, agencyEnabled, pickupName, pickupAddress, pickupInstructions] = useWatch({ control: form.control, name: ["enabled", "homeEnabled", "agencyEnabled", "name", "address", "instructions"] });
  const storeIncomplete = [pickupName, pickupAddress, pickupInstructions].some(value => value.trim()) && !(pickupName.trim() && pickupAddress.trim());
  const { isDirty } = form.formState;
  const saved = result?.saved;
  const { getValues, reset } = form;
  // Loader revalidation must not replace unsaved edits.
  useEffect(() => {
    if (saved && saved.version !== getValues("version")) reset(createDraft(saved));
  }, [saved, getValues, reset]);
  const zonesSaved = zonesFetcher.data?.zonesSaved;
  const { setValue } = form;
  useEffect(() => {
    if (zonesSaved) setValue("version", zonesSaved.version);
  }, [zonesSaved, setValue]);
  if (zonesSaved && zoneHistory.saved !== zonesSaved) setZoneHistory({ state: zonesSaved, saved: zonesSaved });
  const baseZones = zoneHistory.state;
  const zonesState = baseZones ? { ...baseZones, version: Math.max(baseZones.version, saved?.version ?? 0),
    ...(saved && saved.version > baseZones.version ? { home: saved.home, agency: saved.agency } : {}) } : null;
  const zoneSection = zonesState && <DeliveryZonesSection state={zonesState} couriers={settings.couriers} catalog={settings.courierCatalog.couriers}
    pending={navigation.state !== "idle" || zonesFetcher.state !== "idle" || !ready}
    error={zonesFetcher.data?.zonesError?.code}
    saved={zoneHistory.saved}
    onSave={request => zonesFetcher.submit({ intent: "zones", ...request }, { method: "post", encType: "application/json" })} />;
  const zonesLink = zonesState && <p className="text-sm text-muted-foreground">{t("deliverySettings.ratesByZone")} <TextLink href="#delivery-zones">{t("deliverySettings.goToZones")}</TextLink></p>;
  const pending = navigation.state !== "idle" || zonesFetcher.state !== "idle";
  const conflict = result?.error === "conflict";
  const invalidMessage = t("deliverySettings.invalid");
  const revealInvalid = (errors: FieldErrors<FormValues>) => {
    if (errors.name || errors.address || errors.instructions) form.setFocus(errors.name ? "name" : errors.address ? "address" : "instructions");
  };
  const save = (values: FormValues) => {
    if (!ready) return;
    const configured = values.enabled || [values.name, values.address, values.instructions].some(value => value.trim());
    const request: SaveDeliverySettingsRequest = {
      expectedVersion: values.version,
      agency: { enabled: values.agencyEnabled },
      home: { enabled: values.homeEnabled },
      store: values.enabled
        ? { enabled: true, pickupPoint: { name: values.name, address: values.address, instructions: values.instructions.trim() || null } }
        : { enabled: false, pickupPoint: configured
          ? { name: values.name, address: values.address, instructions: values.instructions.trim() || null } : null },
    };
    submit(request, { method: "post", encType: "application/json" });
  };
  return <form className="flex flex-col gap-6" noValidate onSubmit={form.handleSubmit(save, revealInvalid)}>
    <Card><CardContent className="p-0"><FieldSet disabled={pending || !ready} className="gap-0 divide-y divide-border">
      <FieldLegend className="sr-only">{t("deliverySettings.title")}</FieldLegend>
      <MethodRow id="store" icon={Store} title={t("deliverySettings.store")} description={t("deliverySettings.storeScope")}
        control={<Controller name="enabled" control={form.control} render={({ field }) => <Switch id="store-enabled" checked={field.value} onCheckedChange={field.onChange} ref={field.ref} aria-label={t("deliverySettings.enabled")} aria-describedby="store-description" />} />}>
        {/* Incomplete pickup data stays visible so its validation errors can be fixed. */}
        {enabled || storeIncomplete ? <FieldGroup>
          {(["name", "address", "instructions"] as const).map(name => <Controller key={name} name={name} control={form.control} render={({ field, fieldState }) => <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={`pickup-${name}`}>{t(`deliverySettings.${name}`)}</FieldLabel>
            <Input {...field} id={`pickup-${name}`} maxLength={name === "name" ? 120 : name === "address" ? 500 : 1000} aria-invalid={fieldState.invalid} aria-describedby={fieldState.invalid ? `pickup-${name}-error` : undefined} />
            {fieldState.error && <FieldError id={`pickup-${name}-error`}>{invalidMessage}</FieldError>}
          </Field>} />)}
        </FieldGroup> : pickupName && <FieldDescription>{t("deliverySettings.storeKept", { name: pickupName, address: pickupAddress })}</FieldDescription>}
      </MethodRow>
      <MethodRow id="home" icon={Truck} title={t("deliverySettings.home")} description={t("deliverySettings.homeScope")}
        control={<Controller name="homeEnabled" control={form.control} render={({ field }) => <Switch id="home-enabled" checked={field.value} onCheckedChange={field.onChange} ref={field.ref} aria-label={t("deliverySettings.homeEnabled")} aria-describedby="home-description" />} />}>
      </MethodRow>
      <MethodRow id="agency" icon={Package} title={t("deliverySettings.agency")} description={t("deliverySettings.agencyScope")}
        control={<Controller name="agencyEnabled" control={form.control} render={({ field }) => <Switch id="agency-enabled" checked={field.value} onCheckedChange={field.onChange} ref={field.ref} aria-label={t("deliverySettings.agencyEnabled")} aria-describedby="agency-description" />} />}>
        {agencyEnabled && <FieldDescription>{t(settings.courierCatalog.couriers.length > 0 ? "deliverySettings.agencyHowTo" : "deliveryZones.noCatalog")}</FieldDescription>}
      </MethodRow>
      {(homeEnabled || agencyEnabled) && zonesLink && <div className="p-4">{zonesLink}</div>}
    </FieldSet></CardContent></Card>
    <div className="flex flex-col gap-3">
      {result?.error && <Alert variant="destructive"><AlertDescription>{t(`deliverySettings.${result.error}`)}</AlertDescription></Alert>}
      {saved && !isDirty && <Alert variant="success"><AlertDescription>{t("deliverySettings.saved")}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" className="max-sm:w-full max-md:min-h-touch" disabled={pending || !ready || Boolean(conflict)}>{t(pending ? "deliverySettings.saving" : "deliverySettings.save")}</Button>
        {conflict && <Button asChild variant="outline"><a href="">{t("deliverySettings.reload")}</a></Button>}
        {isDirty && <FieldDescription>{t("deliverySettings.unsaved")}</FieldDescription>}</div>
    </div>
    {zoneSection}
  </form>;
}

/** One delivery method: its switch in the header, its settings revealed below while it is offered. */
function MethodRow({ id, icon: Icon, title, description, control, children }: Readonly<{
  id: string; icon: typeof Store; title: string; description: string; control: ReactNode; children?: ReactNode;
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
    {children && <div className="flex min-w-0 flex-col gap-4 sm:pl-7">{children}</div>}
  </section>;
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
