import { useEffect, useRef, useState } from "react";
import { Dialog, RadioGroup } from "radix-ui";
import { Check, ChevronRight, RotateCcw, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data, useBlocker, useFetcher, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { imageResponseSchema } from "@shared/contracts/images";
import { privateUserContext } from "@core/app/private-user-context";
import { Button } from "@core/app/components/ui/button";
import { ErrorState } from "@core/app/components/ui/error-state";
import { resolvePublicImage } from "@core/src/shared/images";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { checkoutAppearance, defaultCheckoutAppearance, parseCompanyId, parseUserId } from "@core/src/features/checkout-appearance";
// Client code imports the domain modules directly: the feature index also exports server-only composition.
import {
  checkoutBackgrounds, type CheckoutAppearance, type CheckoutBackground,
} from "@core/src/features/checkout-appearance/domain/checkout-appearance";
import { checkoutBrandColorCatalog } from "@core/src/features/checkout-appearance/domain/checkout-colors";
import type { CheckoutAppearanceFailure } from "@core/src/features/checkout-appearance/application/checkout-appearance";
import { BrandColorDialog, swatchOf } from "@core/src/features/checkout-appearance/presentation/brand-color-dialog";
import { CheckoutPreviewPlaceholder } from "@core/src/features/checkout-appearance/presentation/checkout-preview-placeholder";
import { resetDraft, sameAppearance, type EditorDraft, type PreviewMode } from "@core/src/features/checkout-appearance/presentation/editor-draft";

const maxLogoBytes = 10 * 1024 * 1024;
const logoTypes = ["image/png", "image/jpeg", "image/webp"];
const failureStatus = { INVALID_CHECKOUT_APPEARANCE: 422, INVALID_IMAGE: 422, INVALID_STORED_DATA: 503, PERSISTENCE_UNAVAILABLE: 503 } as const;

export async function loader({ context }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const companyId = parseCompanyId(access.company.id);
  if (!companyId.success) throw new Response("Invalid company", { status: 500 });
  const loaded = await checkoutAppearance.get(companyId.data);
  if (!loaded.success) {
    bindRequestOperation({ operation: "get_checkout_appearance", outcome: "technical_failure" });
    throw new Response("Unable to load checkout appearance", { status: 503 });
  }
  const published = loaded.data ?? defaultCheckoutAppearance;
  // A missing logo file must not block editing; the seller can upload it again.
  const image = published.logoImageId ? await resolvePublicImage(published.logoImageId) : null;
  bindRequestOperation({ operation: "get_checkout_appearance", outcome: "loaded" });
  return { companyName: access.company.name, published, logoUrl: image?.success ? image.data?.url ?? null : null };
}

type EditorActionData = { success: true; appearance: CheckoutAppearance } | { error: CheckoutAppearanceFailure["code"] };

export async function action({ context, request }: ActionFunctionArgs) {
  const access = context.get(privateUserContext);
  // The company and the author always come from the session, never from the body.
  const companyId = parseCompanyId(access.company.id);
  const userId = parseUserId(access.user.id);
  if (!companyId.success || !userId.success) throw new Response("Invalid session", { status: 500 });
  const body: unknown = await request.json().catch(() => null);
  const saved = await checkoutAppearance.save(companyId.data, userId.data, body);
  if (saved.success) {
    bindRequestOperation({ operation: "save_checkout_appearance", outcome: "saved" });
    return data<EditorActionData>({ success: true, appearance: saved.data });
  }
  const code = saved.error.code;
  bindRequestOperation({ operation: "save_checkout_appearance", outcome: code === "INVALID_STORED_DATA" || code === "PERSISTENCE_UNAVAILABLE" ? "technical_failure" : "invalid_input" });
  return data<EditorActionData>({ error: code }, { status: failureStatus[code] });
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return <ErrorState title={t("checkoutAppearance.loadError")} description={t("checkoutAppearance.loadErrorDescription")}
    action={<Button onClick={() => window.location.reload()}>{t("checkoutAppearance.retry")}</Button>} />;
}

type UploadFailure = "type" | "size" | "failed";

async function uploadLogo(file: File): Promise<{ id: string; url: string } | UploadFailure> {
  if (!logoTypes.includes(file.type)) return "type";
  if (file.size > maxLogoBytes) return "size";
  const body = new FormData();
  body.append("file", file);
  try {
    const response = await fetch("/api/images", { method: "POST", body });
    const image = imageResponseSchema.safeParse(await response.json());
    return response.ok && image.success ? image.data : "failed";
  } catch {
    return "failed";
  }
}

export default function CheckoutAppearanceSettings() {
  const { t } = useTranslation();
  const loaded = useLoaderData<typeof loader>();
  const fetcher = useFetcher<EditorActionData>();
  const published: CheckoutAppearance = loaded.published;
  const [draft, setDraft] = useState<EditorDraft>({ appearance: published, logoUrl: loaded.logoUrl });
  const [mode, setMode] = useState<PreviewMode>("light");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [uploading, setUploading] = useState(false);
  const [uploadFailure, setUploadFailure] = useState<{ reason: UploadFailure; file: File } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const saving = fetcher.state !== "idle";
  const dirty = !sameAppearance(draft.appearance, published);
  const canSave = dirty && !uploading && !saving;
  const blocker = useBlocker(dirty);
  const saveFailure = fetcher.state === "idle" && fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const justSaved = fetcher.state === "idle" && fetcher.data && "success" in fetcher.data && !dirty;
  const colorName = checkoutBrandColorCatalog[draft.appearance.brandColor].name;

  // A page reload or tab close with unsaved changes also asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update(next: Partial<CheckoutAppearance>) {
    setDraft((current) => ({ ...current, appearance: { ...current.appearance, ...next } }));
  }

  async function upload(file: File) {
    setUploading(true);
    setUploadFailure(null);
    const result = await uploadLogo(file);
    setUploading(false);
    if (typeof result === "string") { setUploadFailure({ reason: result, file }); return; }
    setDraft((current) => ({ appearance: { ...current.appearance, logoImageId: result.id as CheckoutAppearance["logoImageId"] }, logoUrl: result.url }));
  }

  function save() {
    const { logoImageId, brandColor, background } = draft.appearance;
    fetcher.submit({ logoImageId, brandColor, background }, { method: "post", encType: "application/json" });
  }

  const backgrounds: Record<CheckoutBackground, string> = {
    white: t("checkoutAppearance.backgroundWhite"), neutral: t("checkoutAppearance.backgroundNeutral"), brand_tint: t("checkoutAppearance.backgroundBrandTint"),
  };
  const uploadMessage = uploadFailure && t(uploadFailure.reason === "type" ? "checkoutAppearance.uploadTypeError"
    : uploadFailure.reason === "size" ? "checkoutAppearance.uploadSizeError" : "checkoutAppearance.uploadError");
  const saveMessage = saveFailure && t(saveFailure === "INVALID_IMAGE" ? "checkoutAppearance.invalidLogo"
    : saveFailure === "INVALID_CHECKOUT_APPEARANCE" ? "checkoutAppearance.invalidAppearance" : "checkoutAppearance.saveError");

  const tabClass = "min-h-touch flex-1 rounded-sm px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-accent aria-selected:text-accent-foreground";
  return <div className="flex flex-col gap-6">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("checkoutAppearance.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("checkoutAppearance.description")}</p>
      </div>
      <div className="flex flex-col gap-2 lg:items-end">
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">{t("checkoutAppearance.unsaved")}</span>}
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => setDraft({ appearance: published, logoUrl: loaded.logoUrl })}>{t("checkoutAppearance.discard")}</Button>
          <Button disabled={!canSave} onClick={save}>{saving ? t("checkoutAppearance.saving") : t("checkoutAppearance.save")}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("checkoutAppearance.appliesToAll")}</p>
        {justSaved && <p role="status" className="text-sm font-medium text-success">{t("checkoutAppearance.saved")}</p>}
        {saveMessage && <p role="alert" className="flex items-center gap-3 text-sm text-destructive">{saveMessage}
          <Button size="sm" variant="outline" disabled={!canSave} onClick={save}>{t("checkoutAppearance.retry")}</Button></p>}
      </div>
    </header>

    <div role="tablist" aria-label={t("checkoutAppearance.tabsLabel")} className="flex gap-1 rounded-md border p-1 lg:hidden">
      <button type="button" role="tab" id="appearance-tab-edit" aria-selected={tab === "edit"} aria-controls="appearance-panel-edit" className={tabClass} onClick={() => setTab("edit")}>{t("checkoutAppearance.tabEdit")}</button>
      <button type="button" role="tab" id="appearance-tab-preview" aria-selected={tab === "preview"} aria-controls="appearance-panel-preview" className={tabClass} onClick={() => setTab("preview")}>{t("checkoutAppearance.tabPreview")}</button>
    </div>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section id="appearance-panel-preview" role="tabpanel" aria-labelledby="appearance-tab-preview" className={`${tab === "preview" ? "block" : "hidden"} min-w-0 lg:order-1 lg:block`}>
        {/* Single integration point: T5 replaces the placeholder with <CheckoutPreviewFrame> (same props). */}
        <CheckoutPreviewPlaceholder companyName={loaded.companyName} mode={mode} onModeChange={setMode}
          appearance={{ logoUrl: draft.logoUrl, brandColor: draft.appearance.brandColor, background: draft.appearance.background }} />
      </section>

      <section id="appearance-panel-edit" role="tabpanel" aria-labelledby="appearance-tab-edit" className={`${tab === "edit" ? "flex" : "hidden"} flex-col divide-y rounded-md border lg:order-2 lg:flex`}>
        <div className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-semibold">{t("checkoutAppearance.logoTitle")}</h2>
          <div className="flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-white">
              {draft.logoUrl && <img src={draft.logoUrl} alt="" className="max-h-full max-w-full object-contain" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{draft.logoUrl ? t("checkoutAppearance.logoTitle") : t("checkoutAppearance.logoNone")}</p>
              <p className="text-xs text-muted-foreground">{t("checkoutAppearance.logoHint")}</p>
            </div>
          </div>
          <input ref={fileInput} type="file" accept={logoTypes.join(",")} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="logo-input"
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}>
              <Upload data-icon="inline-start" aria-hidden="true" />{draft.logoUrl ? t("checkoutAppearance.logoChange") : t("checkoutAppearance.logoUpload")}
            </Button>
            {draft.logoUrl && <Button type="button" variant="ghost" disabled={uploading}
              onClick={() => { setUploadFailure(null); setDraft((current) => ({ appearance: { ...current.appearance, logoImageId: null }, logoUrl: null })); }}>{t("checkoutAppearance.logoRemove")}</Button>}
          </div>
          {uploading && <p role="status" className="text-sm text-muted-foreground">{t("checkoutAppearance.logoUploading")}</p>}
          {uploadMessage && uploadFailure && <p role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">{uploadMessage}
            <Button size="sm" variant="outline" onClick={() => void upload(uploadFailure.file)}>{t("checkoutAppearance.retry")}</Button></p>}
        </div>

        <div className="flex flex-col gap-3 p-5">
          <div><h2 className="text-base font-semibold">{t("checkoutAppearance.colorTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("checkoutAppearance.colorHint")}</p></div>
          <BrandColorDialog value={draft.appearance.brandColor} mode={mode} onUse={(brandColor) => update({ brandColor })}>
            <button type="button" className="flex min-h-touch items-center gap-3 rounded-md border bg-card p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="size-9 shrink-0 rounded-md border border-foreground/10" style={{ backgroundColor: swatchOf(draft.appearance.brandColor, mode) }} data-testid="color-swatch" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{colorName}</span>
                <span className="block text-xs text-muted-foreground">{t(mode === "light" ? "checkoutAppearance.colorToneLight" : "checkoutAppearance.colorToneDark")}</span></span>
              <span className="flex items-center text-sm font-medium">{t("checkoutAppearance.colorChange")}<ChevronRight className="size-4" aria-hidden="true" /></span>
            </button>
          </BrandColorDialog>
        </div>

        <div className="flex flex-col gap-3 p-5">
          <h2 id="appearance-background-label" className="text-base font-semibold">{t("checkoutAppearance.backgroundTitle")}</h2>
          <RadioGroup.Root aria-labelledby="appearance-background-label" value={draft.appearance.background} onValueChange={(background) => update({ background: background as CheckoutBackground })}
            className="grid grid-cols-3 gap-1 rounded-md border p-1">
            {checkoutBackgrounds.map((background) => <RadioGroup.Item key={background} value={background}
              className="flex min-h-touch items-center justify-center gap-1 rounded-sm px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground">
              <RadioGroup.Indicator><Check className="size-3.5" aria-hidden="true" /></RadioGroup.Indicator>{backgrounds[background]}
            </RadioGroup.Item>)}
          </RadioGroup.Root>
          {draft.appearance.background === "brand_tint" && <p className="text-xs text-muted-foreground">{t("checkoutAppearance.backgroundBrandTintHint", { color: colorName })}</p>}
        </div>

        <div className="flex flex-col gap-1 p-5">
          <Button type="button" variant="ghost" className="self-start" onClick={() => setDraft(resetDraft)}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />{t("checkoutAppearance.reset")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("checkoutAppearance.resetNote")}</p>
        </div>
      </section>
    </div>

    <Dialog.Root open={blocker.state === "blocked"} onOpenChange={(open) => { if (!open && blocker.state === "blocked") blocker.reset(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border bg-card p-6 text-card-foreground shadow-lg outline-none">
          <div className="flex flex-col gap-1">
            <Dialog.Title className="text-lg font-semibold">{t("checkoutAppearance.leaveTitle")}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">{t("checkoutAppearance.leaveDescription")}</Dialog.Description>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => blocker.state === "blocked" && blocker.reset()}>{t("checkoutAppearance.keepEditing")}</Button>
            <Button variant="destructive" onClick={() => blocker.state === "blocked" && blocker.proceed()}>{t("checkoutAppearance.discardAndLeave")}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
