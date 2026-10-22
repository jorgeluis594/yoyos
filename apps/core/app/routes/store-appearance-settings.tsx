import { useEffect, useState, useSyncExternalStore } from "react";
import { RotateCcw, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { data, isRouteErrorResponse, useBlocker, useFetcher, useLoaderData, type ActionFunctionArgs, type ClientActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { imageResponseSchema } from "@shared/contracts/images";
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
import { imageUploadLimits } from "@shared/contracts/images";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { parseCompanyId, parseUserId } from "@core/src/features/store-appearance/domain/store-appearance";
// Client code imports the domain modules directly: the composition is server-only.
import type { StoreAppearance } from "@core/src/features/store-appearance/domain/store-appearance";
import type { StoreThemeId } from "@shared/store-themes";
import type { StoreAppearanceFailure } from "@core/src/features/store-appearance/application/store-appearance";
import { StorePreviewFrame } from "@core/src/features/store-appearance/presentation/store-preview-frame";
import { ThemePicker } from "@core/src/features/store-appearance/presentation/theme-picker";
import { resetDraft, sameAppearance, type EditorDraft } from "@core/src/features/store-appearance/presentation/editor-draft";

const maxLogoBytes = imageUploadLimits.maxBytes;
const logoTypes = ["image/png", "image/jpeg", "image/webp"];
const failureStatus = { INVALID_STORE_APPEARANCE: 422, INVALID_IMAGE: 422, INVALID_STORED_DATA: 503, UNKNOWN_STORED_THEME: 503, PERSISTENCE_UNAVAILABLE: 503 } as const;

export async function loader({ context }: LoaderFunctionArgs) {
  const access = context.get(privateUserContext);
  const companyId = parseCompanyId(access.company.id);
  if (!companyId.success) throw new Response("Invalid company", { status: 500 });
  const loaded = await storeAppearance.get(companyId.data);
  // The unknown-theme starting point keeps today's load error until the editor learns to show it.
  if (!loaded.success || loaded.data.kind === "unknown_theme") {
    bindRequestOperation({ operation: "get_store_appearance", outcome: "technical_failure" });
    throw new Response("Unable to load store appearance", { status: 503 });
  }
  bindRequestOperation({ operation: "get_store_appearance", outcome: "loaded" });
  return { published: loaded.data.appearance, logoUrl: loaded.data.logoUrl };
}

type EditorActionData = { success: true; appearance: StoreAppearance } | { error: StoreAppearanceFailure["code"] };

export async function action({ context, request }: ActionFunctionArgs) {
  const access = context.get(privateUserContext);
  // The company and the author always come from the session, never from the body.
  const companyId = parseCompanyId(access.company.id);
  const userId = parseUserId(access.user.id);
  if (!companyId.success || !userId.success) throw new Response("Invalid session", { status: 500 });
  const body: unknown = await request.json().catch(() => null);
  const saved = await storeAppearance.save(companyId.data, userId.data, body);
  if (saved.success) {
    bindRequestOperation({ operation: "save_store_appearance", outcome: "saved" });
    return data<EditorActionData>({ success: true, appearance: saved.data.appearance });
  }
  const code = saved.error.code;
  bindRequestOperation({ operation: "save_store_appearance", outcome: code === "INVALID_STORED_DATA" || code === "PERSISTENCE_UNAVAILABLE" ? "technical_failure" : "invalid_input" });
  return data<EditorActionData>({ error: code }, { status: failureStatus[code] });
}

// A save that gets no response shows the save error with Reintentar instead of replacing the editor with the load error.
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try { return await serverAction<typeof action>(); }
  catch (cause) {
    if (cause instanceof Response || isRouteErrorResponse(cause)) throw cause;
    // The 503 keeps the loader from revalidating, which would also fail offline and lose the draft.
    return data<EditorActionData>({ error: "PERSISTENCE_UNAVAILABLE" }, { status: failureStatus.PERSISTENCE_UNAVAILABLE });
  }
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return <ErrorState title={t("checkoutAppearance.loadError")} description={t("checkoutAppearance.loadErrorDescription")}
    action={<Button onClick={() => window.location.reload()}>{t("checkoutAppearance.retry")}</Button>} />;
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

export default function StoreAppearanceSettings() {
  const { t } = useTranslation();
  const loaded = useLoaderData<typeof loader>();
  const fetcher = useFetcher<EditorActionData>();
  const published: StoreAppearance = loaded.published;
  const [draft, setDraft] = useState<EditorDraft>({ appearance: published, logoUrl: loaded.logoUrl });
  const [tab, setTab] = useState<EditorTab>("edit");
  const wide = useWideLayout();
  // The last submission result the seller has already moved past (draft changed or retry started).
  const [dismissed, setDismissed] = useState<EditorActionData | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [uploadFailure, setUploadFailure] = useState<{ reason: UploadFailure; file: File } | null>(null);

  const saving = fetcher.state !== "idle";
  const dirty = !sameAppearance(draft.appearance, published);
  const busy = uploading || saving;
  const canSave = dirty && !busy;
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
    setDraft(next);
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
    const { logoImageId, theme } = draft.appearance;
    setDismissed(fetcher.data);
    fetcher.submit({ logoImageId, theme }, { method: "post", encType: "application/json" });
  }

  const themeDescriptions: Record<StoreThemeId, string> = {
    classic: t("checkoutAppearance.themeClassicDescription"), boutique: t("checkoutAppearance.themeBoutiqueDescription"),
    antojo: t("checkoutAppearance.themeAntojoDescription"), suave: t("checkoutAppearance.themeSuaveDescription"),
    noche: t("checkoutAppearance.themeNocheDescription"),
  };
  const uploadMessage = uploadFailure && t(uploadFailure.reason === "type" ? "checkoutAppearance.uploadTypeError"
    : uploadFailure.reason === "size" ? "checkoutAppearance.uploadSizeError" : "checkoutAppearance.uploadError");
  const saveMessage = saveFailure && t(saveFailure === "INVALID_IMAGE" ? "checkoutAppearance.invalidLogo"
    : saveFailure === "INVALID_STORE_APPEARANCE" ? "checkoutAppearance.invalidAppearance" : "checkoutAppearance.saveError");

  const previewPanel = <StorePreviewFrame appearance={{ logoUrl: draft.logoUrl, theme: draft.appearance.theme }} />;
  const editPanel = <Card className="gap-0 divide-y py-0">
        <CardContent className="flex flex-col gap-3 p-5">
          <CardTitle>{t("checkoutAppearance.logoTitle")}</CardTitle>
          <div className="flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-white">
              {draft.logoUrl && <img src={draft.logoUrl} alt="" className="max-h-full max-w-full object-contain" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{draft.logoUrl ? t("checkoutAppearance.logoLoaded") : t("checkoutAppearance.logoNone")}</p>
              <p className="text-xs text-muted-foreground">{t("checkoutAppearance.logoHint")}</p>
            </div>
          </div>
          <FileUpload accept={logoTypes.join(",")} disabled={uploading} onFileSelect={(file) => void upload(file)} data-testid="logo-upload">
            <FileUploadActions>
              <FileUploadTrigger>
                <Upload data-icon="inline-start" aria-hidden="true" />{draft.logoUrl ? t("checkoutAppearance.logoChange") : t("checkoutAppearance.logoUpload")}
              </FileUploadTrigger>
              {draft.logoUrl && <Button type="button" variant="ghost" disabled={busy}
                onClick={() => { setUploadFailure(null); changeDraft((current) => ({ appearance: { ...current.appearance, logoImageId: null }, logoUrl: null })); }}>{t("checkoutAppearance.logoRemove")}</Button>}
            </FileUploadActions>
            {uploading && <Alert><AlertDescription>{t("checkoutAppearance.logoUploading")}</AlertDescription></Alert>}
            {uploadMessage && uploadFailure && <Alert variant="destructive" className="flex flex-wrap items-center gap-3">{uploadMessage}
              <Button size="sm" variant="outline" onClick={() => void upload(uploadFailure.file)}>{t("checkoutAppearance.retry")}</Button></Alert>}
          </FileUpload>
        </CardContent>

        <CardContent className="flex flex-col gap-3 p-5">
          <CardTitle>{t("checkoutAppearance.themeTitle")}</CardTitle>
          <ThemePicker value={draft.appearance.theme} label={t("checkoutAppearance.themeOptions")} descriptions={themeDescriptions}
            onChange={(theme) => update({ theme })} />
        </CardContent>

        <CardContent className="flex flex-col gap-1 p-5">
          <Button type="button" variant="ghost" className="self-start" disabled={busy} onClick={() => changeDraft(resetDraft)}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />{t("checkoutAppearance.reset")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("checkoutAppearance.resetNote")}</p>
        </CardContent>
  </Card>;

  return <div className="flex flex-col gap-6">
    <PageHeader className="flex-col lg:flex-row">
      <PageHeader.Heading>
        <PageHeader.Title>{t("checkoutAppearance.title")}</PageHeader.Title>
        <PageHeader.Description>{t("checkoutAppearance.description")}</PageHeader.Description>
      </PageHeader.Heading>
      <div className="flex flex-col gap-2 lg:items-end">
        <PageHeader.Actions className="gap-2">
          {dirty && <Badge variant="secondary">{t("checkoutAppearance.unsaved")}</Badge>}
          <Button variant="ghost" disabled={!dirty || busy} onClick={() => changeDraft({ appearance: published, logoUrl: loaded.logoUrl })}>{t("checkoutAppearance.discard")}</Button>
          <Button disabled={!canSave} onClick={save}>{saving ? t("checkoutAppearance.saving") : t("checkoutAppearance.save")}</Button>
        </PageHeader.Actions>
        <p className="text-xs text-muted-foreground">{t("checkoutAppearance.appliesToAll")}</p>
        {justSaved && <Alert variant="success">{t("checkoutAppearance.saved")}</Alert>}
        {saveMessage && <Alert variant="destructive" className="flex items-center gap-3">{saveMessage}
          <Button size="sm" variant="outline" disabled={!canSave} onClick={save}>{t("checkoutAppearance.retry")}</Button></Alert>}
      </div>
    </PageHeader>

    {wide
      ? <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 lg:order-1">{previewPanel}</section>
        <section className="lg:order-2">{editPanel}</section>
      </div>
      : <Tabs value={tab} onValueChange={(value) => setTab(value as EditorTab)} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <TabsList aria-label={t("checkoutAppearance.tabsLabel")} className="w-full group-data-horizontal/tabs:h-auto lg:hidden">
          <TabsTrigger value="edit" className="min-h-touch">{t("checkoutAppearance.tabEdit")}</TabsTrigger>
          <TabsTrigger value="preview" className="min-h-touch">{t("checkoutAppearance.tabPreview")}</TabsTrigger>
        </TabsList>
        <TabsContent value="preview" forceMount className="min-w-0 data-[state=inactive]:hidden lg:data-[state=inactive]:block lg:order-1">{previewPanel}</TabsContent>
        <TabsContent value="edit" forceMount className="data-[state=inactive]:hidden lg:data-[state=inactive]:block lg:order-2">{editPanel}</TabsContent>
      </Tabs>}

    <Dialog open={blocker.state === "blocked"} onOpenChange={(open) => { if (!open && blocker.state === "blocked") blocker.reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("checkoutAppearance.leaveTitle")}</DialogTitle>
          <DialogDescription>{t("checkoutAppearance.leaveDescription")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => blocker.state === "blocked" && blocker.reset()}>{t("checkoutAppearance.keepEditing")}</Button>
          <Button variant="destructive" onClick={() => blocker.state === "blocked" && blocker.proceed()}>{t("checkoutAppearance.discardAndLeave")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
