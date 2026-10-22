import { useEffect, useRef, useState } from "react";
import type { StoreThemeId } from "@shared/store-themes";
import { storeAppearance } from "@mobile/features/store-appearance/composition";
import { sameDraft, unknownThemeStart, type LogoUploadError, type StoreAppearanceDraft, type StoreLogo } from "@mobile/features/store-appearance/application/store-appearance";
import type { LogoAsset } from "@mobile/features/store-appearance/domain/logo-file";

type Load = Readonly<{ status: "loading" }> | Readonly<{ status: "error" }> | Readonly<{ status: "ready"; baseline: StoreAppearanceDraft; unknownTheme: boolean }>;
export type LogoState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "uploading" }>
  | Readonly<{ kind: "failed"; code: LogoUploadError["code"]; again: Readonly<{ kind: "asset"; asset: LogoAsset }> | Readonly<{ kind: "pick"; source: LogoAsset["source"] }> }>;
export type SaveState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "saving" }>
  | Readonly<{ kind: "saved" }>
  | Readonly<{ kind: "failed"; code: "INVALID_STORE_APPEARANCE" | "INVALID_IMAGE" | "UNAVAILABLE" }>;

const idle = { kind: "idle" } as const;

export function useStoreAppearance() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [draft, setDraft] = useState<StoreAppearanceDraft>(unknownThemeStart);
  const [logo, setLogo] = useState<LogoState>(idle);
  const [save, setSave] = useState<SaveState>(idle);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const picking = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let current = true;
    void storeAppearance.loadStoreAppearance().then(result => {
      if (!current) return;
      if (!result.success) { setLoad({ status: "error" }); return; }
      // An unknown stored theme is not an error: the editor starts on what buyers see, which is not a draft.
      const baseline = result.data.kind === "readable" ? result.data.appearance : unknownThemeStart;
      setDraft(baseline);
      setLoad({ status: "ready", baseline, unknownTheme: result.data.kind === "unknown_theme" });
    });
    return () => { current = false; };
  }, [attempt]);

  const changed = load.status === "ready" && !sameDraft(draft, load.baseline);
  const uploading = logo.kind === "uploading";
  const saving = save.kind === "saving";
  const edit = (next: StoreAppearanceDraft) => { setDraft(next); setSave(idle); };

  async function upload(asset: LogoAsset) {
    setLogo({ kind: "uploading" });
    const result = await storeAppearance.uploadStoreLogo(asset);
    if (!mounted.current) return;
    if (!result.success) { setLogo({ kind: "failed", code: result.error.code, again: { kind: "asset", asset } }); return; }
    setLogo(idle);
    const uploaded: StoreLogo = { id: result.data.id, url: result.data.url };
    setDraft(current => ({ ...current, logo: uploaded }));
    setSave(idle);
  }
  async function chooseLogo(source: LogoAsset["source"]): Promise<"permission_denied" | undefined> {
    if (picking.current) return undefined;
    // The picker is not an upload: «Subiendo logo…» starts once an asset was picked.
    picking.current = true;
    setLogo(idle);
    const picked = await storeAppearance.pickLogo(source);
    picking.current = false;
    if (!mounted.current) return undefined;
    if (!picked.success) {
      const denied = picked.error.code === "CAMERA_PERMISSION_DENIED";
      setLogo(denied ? idle : { kind: "failed", code: "UPLOAD_FAILED", again: { kind: "pick", source } });
      return denied ? "permission_denied" : undefined;
    }
    if (!picked.data) { setLogo(idle); return undefined; }
    await upload(picked.data);
    return undefined;
  }

  return {
    load, draft, logo, save, changed, uploading, saving,
    /** Only with unsaved changes, or at the unknown-theme starting point (saving it as is is allowed); a successful save hides it. */
    showBar: changed || (load.status === "ready" && load.unknownTheme),
    retryLoad: () => { setLoad({ status: "loading" }); setAttempt(value => value + 1); },
    chooseTheme: (theme: StoreThemeId) => { if (!saving) edit({ ...draft, theme }); },
    removeLogo: () => { if (!saving && !uploading) { edit({ ...draft, logo: null }); setLogo(idle); } },
    chooseLogo,
    retryLogo: () => { if (logo.kind === "failed") void (logo.again.kind === "asset" ? upload(logo.again.asset) : chooseLogo(logo.again.source)); },
    discard: () => { if (load.status === "ready" && !saving && !uploading) { setDraft(load.baseline); setLogo(idle); setSave(idle); } },
    async submit() {
      if (load.status !== "ready" || saving || uploading) return;
      setSave({ kind: "saving" });
      const result = await storeAppearance.saveStoreAppearance({ theme: draft.theme, logoImageId: draft.logo?.id ?? null });
      if (!mounted.current) return;
      if (!result.success) {
        const code = result.error.code;
        setSave({ kind: "failed", code: code === "INVALID_STORE_APPEARANCE" || code === "INVALID_IMAGE" ? code : "UNAVAILABLE" });
        return;
      }
      // The PUT response is the new baseline; nothing is read again.
      setLoad({ status: "ready", baseline: result.data.appearance, unknownTheme: false });
      setDraft(result.data.appearance);
      setSave({ kind: "saved" });
    },
  };
}
