import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { z } from "zod";
import { Tabs } from "radix-ui";
import { Store, Truck, Package } from "lucide-react";
import { useClientReady } from "@core/app/use-client-ready";
import { useTranslation } from "react-i18next";
import { useFetcher, useActionData, useLoaderData, useNavigation, useSubmit, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { courierCatalogSchema, saveDeliverySettingsSchema, saveDeliveryZonesSchema, type CourierCatalogResponse, type DeliveryZonesResponse, type DeliverySettingsResponse, type SaveDeliverySettingsRequest } from "@shared/contracts/delivery-settings";
import { privateUserContext } from "@core/app/private-user-context";
import { deliverySettings } from "@core/src/features/delivery-settings/composition";
import { toCourierInputs, toDeliverySettingsResponse } from "@core/src/features/delivery-settings/presentation/settings-response";
import { toDeliveryZonesResponse } from "@core/src/features/delivery-settings/presentation/zones-response";
import { log } from "@core/src/shared/infrastructure/logger";
import { PageContainer } from "@core/app/components/ui/page-container";
import { PageHeader } from "@core/app/components/ui/page-header";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel, controlClass } from "@core/app/components/ui/field";
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
    const couriers = toCourierInputs(parsed.data.couriers);
    if (!couriers.success) return { error: "invalid" as const };
    const result = await deliverySettings.save({ ...parsed.data, couriers: couriers.data }, { companyId: access.company.id, userId: access.user.id });
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
  couriers: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("new"), courierId: z.uuid(), name: z.string(), enabled: z.boolean() }),
    z.object({ kind: z.literal("existing"), id: z.uuid(), courierId: z.uuid(), name: z.string(), enabled: z.boolean() }),
  ])),
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
  if (values.agencyEnabled && !values.couriers.some(courier => courier.enabled)) {
    context.addIssue({ code: "custom", path: ["agencyEnabled"], message: "required" });
  }
});
type FormValues = z.infer<typeof formSchema>;

function createDraft(settings: DeliverySettingsResponse): FormValues {
  return {
    version: settings.version,
    agencyEnabled: settings.agency.enabled,
    couriers: settings.couriers.map(courier => ({ ...courier, kind: "existing" as const })),
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
  const [tab, setTab] = useState("store");
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: createDraft(settings), shouldFocusError: false });
  const [catalogChoice, setCatalogChoice] = useState("");
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "couriers", keyName: "fieldKey" });
  const [enabled, homeEnabled, agencyEnabled] = useWatch({ control: form.control, name: ["enabled", "homeEnabled", "agencyEnabled"] });
  const { isDirty } = form.formState;
  const chosenCourierIds = new Set(fields.map(courier => courier.courierId));
  const availableCouriers = settings.courierCatalog.couriers.filter(courier => !chosenCourierIds.has(courier.id));
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
  const zoneSection = zonesState && <DeliveryZonesSection state={zonesState}
    pending={navigation.state !== "idle" || zonesFetcher.state !== "idle" || !ready}
    error={zonesFetcher.data?.zonesError?.code}
    saved={zoneHistory.saved}
    onSave={request => zonesFetcher.submit({ intent: "zones", ...request }, { method: "post", encType: "application/json" })} />;
  const pending = navigation.state !== "idle" || zonesFetcher.state !== "idle";
  const conflict = result?.error === "conflict";
  const invalidMessage = t("deliverySettings.invalid");
  const revealInvalid = (errors: FieldErrors<FormValues>) => {
    if (errors.name || errors.address || errors.instructions) {
      flushSync(() => setTab("store"));
      form.setFocus(errors.name ? "name" : errors.address ? "address" : "instructions");
    } else if (errors.agencyEnabled || errors.couriers) {
      flushSync(() => setTab("agency"));
      form.setFocus("agencyEnabled");
    }
  };
  const save = (values: FormValues) => {
    if (!ready) return;
    const configured = values.enabled || [values.name, values.address, values.instructions].some(value => value.trim());
    const request: SaveDeliverySettingsRequest = {
      expectedVersion: values.version,
      agency: { enabled: values.agencyEnabled },
      couriers: values.couriers.map(courier => courier.kind === "new" ? { kind: courier.kind, courierId: courier.courierId, enabled: courier.enabled } : { kind: courier.kind, id: courier.id, enabled: courier.enabled }),
      home: { enabled: values.homeEnabled },
      store: values.enabled
        ? { enabled: true, pickupPoint: { name: values.name, address: values.address, instructions: values.instructions.trim() || null } }
        : { enabled: false, pickupPoint: configured
          ? { name: values.name, address: values.address, instructions: values.instructions.trim() || null } : null },
    };
    submit(request, { method: "post", encType: "application/json" });
  };
  return <form className="flex flex-col gap-6" noValidate onSubmit={form.handleSubmit(save, revealInvalid)}>
    <Tabs.Root value={tab} onValueChange={setTab} className="flex min-w-0 flex-col gap-6">
      <Tabs.List aria-label={t("deliverySettings.title")} className="grid grid-cols-3 border-b border-border">
        {([
          { value: "store", icon: Store, enabled },
          { value: "home", icon: Truck, enabled: homeEnabled },
          { value: "agency", icon: Package, enabled: agencyEnabled },
        ] as const).map(method => <Tabs.Trigger key={method.value} value={method.value}
          className="flex min-h-touch min-w-0 flex-col items-center gap-1 border-b-2 border-transparent px-2 pb-3 pt-2 text-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-[state=active]:border-primary data-[state=active]:text-primary">
          <span className="flex items-center gap-2 font-semibold"><method.icon aria-hidden="true" className="size-4" />{t(`deliverySettings.tabs.${method.value}`)}</span>
          <span className="text-xs">{t(method.enabled ? "deliverySettings.active" : "deliverySettings.inactive")}</span>
        </Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value="store" forceMount className="outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=inactive]:hidden">
        <fieldset disabled={pending || !ready}>
          <legend className="mb-3 text-lg font-semibold">{t("deliverySettings.store")}</legend>
          <FieldGroup>
            <Controller name="enabled" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="store-enabled" className="flex min-h-touch cursor-pointer items-center gap-3"><input id="store-enabled" type="checkbox" className="size-4 shrink-0 accent-primary" checked={field.value} onChange={event => field.onChange(event.target.checked)} ref={field.ref} />{t("deliverySettings.enabled")}</FieldLabel></Field>} />
            <p className="text-sm text-muted-foreground">{t("deliverySettings.storeScope")}</p>
            {(["name", "address", "instructions"] as const).map(name => <Controller key={name} name={name} control={form.control} render={({ field, fieldState }) => <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`pickup-${name}`}>{t(`deliverySettings.${name}`)}</FieldLabel>
              <Input {...field} id={`pickup-${name}`} maxLength={name === "name" ? 120 : name === "address" ? 500 : 1000} aria-invalid={fieldState.invalid} aria-describedby={fieldState.invalid ? `pickup-${name}-error` : undefined} />
              {fieldState.error && <FieldError id={`pickup-${name}-error`}>{invalidMessage}</FieldError>}
            </Field>} />)}
          </FieldGroup>
        </fieldset>
      </Tabs.Content>
      <Tabs.Content value="home" forceMount className="outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=inactive]:hidden">
        <fieldset disabled={pending || !ready}>
          <legend className="mb-3 text-lg font-semibold">{t("deliverySettings.home")}</legend>
          <FieldGroup>
            <Controller name="homeEnabled" control={form.control} render={({ field }) => <Field><FieldLabel htmlFor="home-enabled" className="flex min-h-touch cursor-pointer items-center gap-3"><input id="home-enabled" type="checkbox" className="size-4 shrink-0 accent-primary" checked={field.value} onChange={event => field.onChange(event.target.checked)} ref={field.ref} />{t("deliverySettings.homeEnabled")}</FieldLabel></Field>} />
            <p className="text-sm text-muted-foreground">{t("deliverySettings.homeScope")}</p>
          </FieldGroup>
        </fieldset>
      </Tabs.Content>
      <Tabs.Content value="agency" forceMount className="outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=inactive]:hidden">
        <fieldset disabled={pending || !ready}>
          <legend className="mb-3 text-lg font-semibold">{t("deliverySettings.agency")}</legend>
          <FieldGroup>
            <Controller name="agencyEnabled" control={form.control} render={({ field, fieldState }) => <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="agency-enabled" className="flex min-h-touch cursor-pointer items-center gap-3"><input id="agency-enabled" type="checkbox" className="size-4 shrink-0 accent-primary" checked={field.value} onChange={event => field.onChange(event.target.checked)} ref={field.ref} aria-invalid={fieldState.invalid} aria-describedby={fieldState.invalid ? "agency-enabled-error" : undefined} />{t("deliverySettings.agencyEnabled")}</FieldLabel>
              {fieldState.error && <FieldError id="agency-enabled-error">{t("deliverySettings.courierHint")}</FieldError>}
            </Field>} />
            <p className="text-sm text-muted-foreground">{t("deliverySettings.agencyScope")}</p>
            {fields.length === 0 && <p className="text-sm text-muted-foreground">{t("deliverySettings.noCouriers")}</p>}
            {fields.map((courier, index) => <div key={courier.fieldKey} className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
              <p className="font-medium">{courier.name}</p>
              <Controller name={`couriers.${index}.enabled`} control={form.control} render={({ field }) => <Field><FieldLabel htmlFor={`courier-enabled-${courier.fieldKey}`} className="flex min-h-touch cursor-pointer items-center gap-3"><input id={`courier-enabled-${courier.fieldKey}`} type="checkbox" className="size-4 shrink-0 accent-primary" checked={field.value} onChange={event => field.onChange(event.target.checked)} ref={field.ref} />{t("deliverySettings.courierEnabled", { name: courier.name })}</FieldLabel></Field>} />
              {courier.kind === "new" && <Button type="button" variant="ghost" className="self-start max-md:min-h-touch" aria-label={t("deliverySettings.removeCourierLabel", { name: courier.name })} onClick={() => remove(index)}>{t("deliverySettings.removeCourier")}</Button>}
            </div>)}
            {availableCouriers.length > 0 && <div className="flex flex-wrap items-end gap-3">
              <Field className="min-w-48 flex-1"><FieldLabel htmlFor="courier-catalog">{t("deliverySettings.catalogCourier")}</FieldLabel>
                <select id="courier-catalog" className={controlClass} value={catalogChoice} onChange={event => setCatalogChoice(event.target.value)}>
                  <option value="">{t("deliverySettings.chooseCatalogCourier")}</option>
                  {availableCouriers.map(courier => <option key={courier.id} value={courier.id}>{courier.name}</option>)}
                </select></Field>
              <Button type="button" variant="outline" className="max-md:min-h-touch" disabled={!catalogChoice}
                onClick={() => { const courier = availableCouriers.find(entry => entry.id === catalogChoice); if (!courier) return; append({ kind: "new", courierId: courier.id, name: courier.name, enabled: true }); setCatalogChoice(""); }}>{t("deliverySettings.addCourier")}</Button>
            </div>}
          </FieldGroup>
        </fieldset>
      </Tabs.Content>
    </Tabs.Root>
    {zoneSection}
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      {result?.error && <p role="alert" className="text-sm text-destructive">{t(`deliverySettings.${result.error}`)}</p>}
      {saved && !isDirty && <p role="status">{t("deliverySettings.saved")}</p>}
      <p className="text-sm text-muted-foreground">{t(isDirty ? "deliverySettings.unsaved" : "deliverySettings.saveScope")}</p>
      <div className="flex flex-wrap gap-3"><Button type="submit" className="max-sm:w-full max-md:min-h-touch" disabled={pending || !ready || Boolean(conflict)}>{t(pending ? "deliverySettings.saving" : "deliverySettings.save")}</Button>
        {conflict && <Button asChild variant="outline"><a href="">{t("deliverySettings.reload")}</a></Button>}</div>
    </div>
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
