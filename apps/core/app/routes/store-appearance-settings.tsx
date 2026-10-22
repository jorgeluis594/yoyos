import { useEffect, useState, useSyncExternalStore } from "react";
import { RotateCcw, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data, isRouteErrorResponse, useBlocker, useFetcher, useLoaderData, useRevalidator, type ActionFunctionArgs, type ClientActionFunctionArgs, type LoaderFunctionArgs, type ShouldRevalidateFunctionArgs } from "react-router";
import { privateUserContext } from "@core/app/private-user-context";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Badge } from "@core/app/components/ui/badge";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent, CardTitle } from "@core/app/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { FileUpload, FileUploadActions, FileUploadTrigger } from "@core/app/components/ui/file-upload";
import { PageHeader } from "@core/app/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/app/components/ui/tabs";
import { ErrorState } from "@core/app/components/ui/error-state";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { catalogSettings, type CatalogSettingsAccess } from "@core/src/features/catalog";
import { parseCompanyId, parseUserId } from "@core/src/features/store-appearance/domain/store-appearance";
// Client code imports the domain modules directly: the composition is server-only.
import type { StoreAppearance } from "@core/src/features/store-appearance/domain/store-appearance";
import type { StoreThemeId } from "@shared/store-themes";
import { StorePreviewFrame } from "@core/src/features/store-appearance/presentation/store-preview-frame";
import { ThemePicker } from "@core/src/features/store-appearance/presentation/theme-picker";
import { baselineOf, resetDraft, sameAppearance, type EditorDraft } from "@core/src/features/store-appearance/presentation/editor-draft";
import { logoTypes, uploadLogo, type LogoUploadFailure } from "@core/src/features/store-appearance/presentation/logo-upload";
import { CatalogPublicationCard } from "@core/app/components/catalog-publication-card";
import { editorActionSchema, type AppearancePart, type EditorActionResult, type EditorIntent, type PublicationPart } from "@core/app/components/store-appearance-editor-actions";

const failureStatus = { INVALID_STORE_APPEARANCE: 422, INVALID_IMAGE: 422, INVALID_STORED_DATA: 503, UNKNOWN_STORED_THEME: 503, PERSISTENCE_UNAVAILABLE: 503 } as const;

function sessionOf(context: LoaderFunctionArgs["context"]) {
  const access = context.get(privateUserContext);
  const companyId = parseCompanyId(access.company.id);
  if (!companyId.success) throw new Response("Invalid company", { status: 500 });
  return { companyId: companyId.data, access };
}

async function readAppearance(companyId: Parameters<typeof storeAppearance.get>[0]): Promise<AppearancePart> {
  const loaded = await storeAppearance.get(companyId);
  if (!loaded.success) return { kind: "failed" };
  return loaded.data.kind === "unknown_theme" ? { kind: "unknown_theme" }
    : { kind: "readable", published: loaded.data.appearance, logoUrl: loaded.data.logoUrl };
}

async function readPublication(access: CatalogSettingsAccess): Promise<PublicationPart> {
  const loaded = await catalogSettings.get(access);
  return loaded.success ? { kind: "loaded", published: loaded.data.published } : { kind: "failed" };
}

/** The two parts load together and fail on their own: neither one hides the other. */
export async function loader({ context }: LoaderFunctionArgs) {
  const { companyId, access } = sessionOf(context);
  const [appearance, publication] = await Promise.all([
    readAppearance(companyId),
    readPublication({ companyId: access.company.id, userId: access.user.id } as CatalogSettingsAccess),
  ]);
  bindRequestOperation({ operation: "get_store_appearance", outcome: appearance.kind === "failed" ? "technical_failure" : "loaded" });
  return { appearance, publication };
}

async function saveAppearance(context: ActionFunctionArgs["context"], appearance: unknown) {
  const { companyId, access } = sessionOf(context);
  // The company and the author always come from the session, never from the body.
  const userId = parseUserId(access.user.id);
  if (!userId.success) throw new Response("Invalid session", { status: 500 });
  const saved = await storeAppearance.save(companyId, userId.data, appearance);
  if (saved.success) {
    bindRequestOperation({ operation: "save_store_appearance", outcome: "saved" });
    return data<EditorActionResult>({ intent: "save-appearance", success: true, appearance: saved.data.appearance });
  }
  const code = saved.error.code;
  bindRequestOperation({ operation: "save_store_appearance", outcome: code === "INVALID_STORED_DATA" || code === "PERSISTENCE_UNAVAILABLE" ? "technical_failure" : "invalid_input" });
  return data<EditorActionResult>({ intent: "save-appearance", error: code }, { status: failureStatus[code] });
}

async function setPublication(context: ActionFunctionArgs["context"], published: boolean) {
  const { access } = sessionOf(context);
  const saved = await catalogSettings.setPublication(published, { companyId: access.company.id, userId: access.user.id } as CatalogSettingsAccess);
  if (saved.success) {
    bindRequestOperation({ operation: "set_catalog_publication", outcome: "saved" });
    return data<EditorActionResult>({ intent: "set-publication", published: saved.data.published });
  }
  bindRequestOperation({ operation: "set_catalog_publication", outcome: "technical_failure" });
  return data<EditorActionResult>({ intent: "set-publication", error: true }, { status: 503 });
}

export async function action({ context, request }: ActionFunctionArgs) {
  const body = editorActionSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return data({ error: "INVALID_INPUT" as const }, { status: 400 });
  return body.data.intent === "save-appearance" ? saveAppearance(context, body.data.appearance) : setPublication(context, body.data.published);
}

async function intentOf(request: Request): Promise<EditorIntent> {
  const body = editorActionSchema.safeParse(await request.clone().json().catch(() => null));
  return body.success ? body.data.intent : "save-appearance";
}

// A request that gets no response shows the error of its own part instead of replacing the editor with the load error.
export async function clientAction({ request, serverAction }: ClientActionFunctionArgs) {
  try { return await serverAction<typeof action>(); }
  catch (cause) {
    if (cause instanceof Response || isRouteErrorResponse(cause)) throw cause;
    // The 503 keeps the loader from revalidating, which would also fail offline and lose the draft.
    return await intentOf(request) === "set-publication"
      ? data<EditorActionResult>({ intent: "set-publication", error: true }, { status: 503 })
      : data<EditorActionResult>({ intent: "save-appearance", error: "PERSISTENCE_UNAVAILABLE" }, { status: failureStatus.PERSISTENCE_UNAVAILABLE });
  }
}

/** Only a saved appearance is read again: failures keep the draft, and a publication change is already on the card. */
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (typeof actionResult !== "object" || actionResult === null) return defaultShouldRevalidate;
  if (!("intent" in actionResult) || "error" in actionResult) return false;
  return actionResult.intent === "save-appearance";
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return <ErrorState title={t("storeAppearance.loadError")} description={t("storeAppearance.loadErrorDescription")}
    action={<Button onClick={() => window.location.reload()}>{t("storeAppearance.retry")}</Button>} />;
}

type EditorTab = "edit" | "preview";
const wideLayout = "(min-width: 64rem)"; // Tailwind `lg`

/** The server and the hydration pass render the phone layout; its `lg:` classes already look like the wide one. */
function useWideLayout(): boolean {
  return useSyncExternalStore(
    (change) => { const media = window.matchMedia(wideLayout); media.addEventListener("change", change); return () => media.removeEventListener("change", change); },
    () => window.matchMedia(wideLayout).matches,
    () => false,
  );
}

export default function StoreAppearanceSettings() {
  const { t } = useTranslation();
  const { appearance, publication } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<EditorActionResult>();
  const revalidator = useRevalidator();
  // A later failed read keeps the baseline the editor last knew, so saving and the leave confirmation keep working.
  const [lastRead, setLastRead] = useState<AppearancePart | null>(appearance.kind === "failed" ? null : appearance);
  if (appearance.kind !== "failed" && appearance !== lastRead) setLastRead(appearance);
  const source = appearance.kind === "failed" ? lastRead : appearance;
  const baseline = source && baselineOf(source);
  const unknownTheme = source?.kind === "unknown_theme";
  // The draft starts from the first appearance that loads and later reads never reset it.
  const [draft, setDraft] = useState<EditorDraft | null>(baseline);
  if (draft === null && baseline !== null) setDraft(baseline);
  const [tab, setTab] = useState<EditorTab>("edit");
  const wide = useWideLayout();
  // The last submission result the seller has already moved past (draft changed or retry started).
  const [dismissed, setDismissed] = useState<EditorActionResult | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [uploadFailure, setUploadFailure] = useState<{ reason: LogoUploadFailure; file: File } | null>(null);

  const saving = fetcher.state !== "idle";
  const dirty = !!draft && !!baseline && !sameAppearance(draft.appearance, baseline.appearance);
  // The unknown-theme starting point is not a draft, but saving it as it is stores Clásico without logo.
  const atStart = unknownTheme && !dirty;
  const busy = uploading || saving;
  const canSave = (dirty || unknownTheme) && !busy;
  const blocker = useBlocker(dirty);
  // A finished submission reports once; any later draft change or retry dismisses it.
  const result = fetcher.state === "idle" && fetcher.data !== dismissed ? fetcher.data : undefined;
  const saveFailure = result && "error" in result ? result.error : null;
  const justSaved = !!result && "success" in result;

  // A page reload or tab close with unsaved changes also asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function changeDraft(next: EditorDraft | ((current: EditorDraft) => EditorDraft)) {
    setDismissed(fetcher.data);
    setDraft((current) => current && (typeof next === "function" ? next(current) : next));
  }

  function update(next: Partial<StoreAppearance>) {
    changeDraft((current) => ({ ...current, appearance: { ...current.appearance, ...next } }));
  }

  async function upload(file: File) {
    setUploading(true);
    setUploadFailure(null);
    const result = await uploadLogo(file);
    setUploading(false);
    if (typeof result === "string") { setUploadFailure({ reason: result, file }); return; }
    changeDraft((current) => ({ appearance: { ...current.appearance, logoImageId: result.id as StoreAppearance["logoImageId"] }, logoUrl: result.url }));
  }

  function save() {
    if (!draft) return;
    const { logoImageId, theme } = draft.appearance;
    setDismissed(fetcher.data);
    fetcher.submit({ intent: "save-appearance", appearance: { logoImageId, theme } }, { method: "post", encType: "application/json" });
  }

  const themeDescriptions: Record<StoreThemeId, string> = {
    classic: t("storeAppearance.themeClassicDescription"), boutique: t("storeAppearance.themeBoutiqueDescription"),
    antojo: t("storeAppearance.themeAntojoDescription"), suave: t("storeAppearance.themeSuaveDescription"),
    noche: t("storeAppearance.themeNocheDescription"),
  };
  const uploadMessage = uploadFailure && t(({ type: "storeAppearance.uploadTypeError", size: "storeAppearance.uploadSizeError",
    dimensions: "storeAppearance.uploadDimensionsError", failed: "storeAppearance.uploadError" } as const)[uploadFailure.reason]);
  const saveMessage = saveFailure && t(saveFailure === "INVALID_IMAGE" ? "storeAppearance.invalidLogo"
    : saveFailure === "INVALID_STORE_APPEARANCE" ? "storeAppearance.invalidAppearance" : "storeAppearance.saveError");

  const publicationCard = <CatalogPublicationCard publication={publication} />;
  const previewPanel = draft && <StorePreviewFrame appearance={{ logoUrl: draft.logoUrl, theme: draft.appearance.theme }} />;
  const draftCard = draft && <Card className="gap-0 divide-y py-0">
        <CardContent className="flex flex-col gap-3 p-5">
          <CardTitle>{t("storeAppearance.logoTitle")}</CardTitle>
          <div className="flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-white">
              {draft.logoUrl && <img src={draft.logoUrl} alt="" className="max-h-full max-w-full object-contain" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{draft.logoUrl ? t("storeAppearance.logoLoaded") : t("storeAppearance.logoNone")}</p>
              <p className="text-xs text-muted-foreground">{t("storeAppearance.logoHint")}</p>
            </div>
          </div>
          <FileUpload accept={logoTypes.join(",")} disabled={uploading} onFileSelect={(file) => void upload(file)} data-testid="logo-upload">
            <FileUploadActions>
              <FileUploadTrigger>
                <Upload data-icon="inline-start" aria-hidden="true" />{draft.logoUrl ? t("storeAppearance.logoChange") : t("storeAppearance.logoUpload")}
              </FileUploadTrigger>
              {draft.logoUrl && <Button type="button" variant="ghost" disabled={busy}
                onClick={() => { setUploadFailure(null); changeDraft((current) => ({ appearance: { ...current.appearance, logoImageId: null }, logoUrl: null })); }}>{t("storeAppearance.logoRemove")}</Button>}
            </FileUploadActions>
            {uploading && <Alert><AlertDescription>{t("storeAppearance.logoUploading")}</AlertDescription></Alert>}
            {uploadMessage && uploadFailure && <Alert variant="destructive" className="flex flex-wrap items-center gap-3">{uploadMessage}
              <Button size="sm" variant="outline" onClick={() => void upload(uploadFailure.file)}>{t("storeAppearance.retry")}</Button></Alert>}
          </FileUpload>
        </CardContent>

        <CardContent className="flex flex-col gap-3 p-5">
          <CardTitle>{t("storeAppearance.themeTitle")}</CardTitle>
          <ThemePicker value={draft.appearance.theme} label={t("storeAppearance.themeOptions")} descriptions={themeDescriptions}
            onChange={(theme) => update({ theme })} />
        </CardContent>

        {!atStart && <CardContent className="flex flex-col gap-1 p-5">
          <Button type="button" variant="ghost" className="self-start" disabled={busy} onClick={() => changeDraft(resetDraft)}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />{t("storeAppearance.reset")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("storeAppearance.resetNote")}</p>
        </CardContent>}
  </Card>;
  const editPanel = <div className="flex flex-col gap-6">{draftCard}{publicationCard}</div>;

  return <div className="flex flex-col gap-6">
    <PageHeader className="flex-col lg:flex-row">
      <PageHeader.Heading>
        <PageHeader.Title>{t("storeAppearance.title")}</PageHeader.Title>
        <PageHeader.Description>{t("storeAppearance.description")}</PageHeader.Description>
      </PageHeader.Heading>
      <div className="flex flex-col gap-2 lg:items-end">
        {baseline && <PageHeader.Actions className="gap-2">
          {dirty && <Badge variant="secondary">{t("storeAppearance.unsaved")}</Badge>}
          {!atStart && <Button variant="ghost" disabled={!dirty || busy} onClick={() => changeDraft(baseline)}>{t("storeAppearance.discard")}</Button>}
          <Button disabled={!canSave} onClick={save}>{saving ? t("storeAppearance.saving") : t("storeAppearance.save")}</Button>
        </PageHeader.Actions>}
        <p className="text-xs text-muted-foreground">{t("storeAppearance.appliesToAll")}</p>
        {justSaved && <Alert variant="success">{t("storeAppearance.saved")}</Alert>}
        {saveMessage && <Alert variant="destructive" className="flex items-center gap-3">{saveMessage}
          <Button size="sm" variant="outline" disabled={!canSave} onClick={save}>{t("storeAppearance.retry")}</Button></Alert>}
      </div>
    </PageHeader>

    {unknownTheme && <Alert role="note">{t("storeAppearance.unknownThemeNotice")}</Alert>}

    {!draft
      ? <div className="flex flex-col gap-6">
        <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="font-medium">{t("storeAppearance.loadError")}</p><p>{t("storeAppearance.loadErrorDescription")}</p></div>
          <Button size="sm" variant="outline" disabled={revalidator.state !== "idle"} onClick={() => void revalidator.revalidate()}>{t("storeAppearance.retry")}</Button>
        </Alert>
        {publicationCard}
      </div>
      : wide
      ? <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 lg:order-1">{previewPanel}</section>
        <section className="lg:order-2">{editPanel}</section>
      </div>
      : <Tabs value={tab} onValueChange={(value) => setTab(value as EditorTab)} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <TabsList aria-label={t("storeAppearance.tabsLabel")} className="w-full group-data-horizontal/tabs:h-auto lg:hidden">
          <TabsTrigger value="edit" className="min-h-touch">{t("storeAppearance.tabEdit")}</TabsTrigger>
          <TabsTrigger value="preview" className="min-h-touch">{t("storeAppearance.tabPreview")}</TabsTrigger>
        </TabsList>
        <TabsContent value="preview" forceMount className="min-w-0 data-[state=inactive]:hidden lg:data-[state=inactive]:block lg:order-1">{previewPanel}</TabsContent>
        <TabsContent value="edit" forceMount className="data-[state=inactive]:hidden lg:data-[state=inactive]:block lg:order-2">{editPanel}</TabsContent>
      </Tabs>}

    <Dialog open={blocker.state === "blocked"} onOpenChange={(open) => { if (!open && blocker.state === "blocked") blocker.reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("storeAppearance.leaveTitle")}</DialogTitle>
          <DialogDescription>{t("storeAppearance.leaveDescription")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => blocker.state === "blocked" && blocker.reset()}>{t("storeAppearance.keepEditing")}</Button>
          <Button variant="destructive" onClick={() => blocker.state === "blocked" && blocker.proceed()}>{t("storeAppearance.discardAndLeave")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
