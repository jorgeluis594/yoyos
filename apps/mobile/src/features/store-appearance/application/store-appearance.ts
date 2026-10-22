import type { SaveStoreAppearanceBody } from "@shared/contracts/store-appearance";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { defaultStoreTheme, type StoreThemeId } from "@shared/store-themes";
import type { TransportError } from "@mobile/shared/application/transport-error";
import type { UploadImageError } from "@mobile/shared/infrastructure/image-api";
import { decideLogoAsset, type LogoAsset } from "@mobile/features/store-appearance/domain/logo-file";

/** `url: null` is a stored logo that cannot be resolved; keeping its id means a theme-only save does not erase it. */
export type StoreLogo = Readonly<{ id: string; url: string | null }>;
export type StoreAppearanceDraft = Readonly<{ theme: StoreThemeId; logo: StoreLogo | null }>;
export type StoreAppearanceState = Readonly<{ kind: "readable"; appearance: StoreAppearanceDraft }> | Readonly<{ kind: "unknown_theme" }>;
export type SaveStoreAppearanceError = Readonly<{ code: "INVALID_STORE_APPEARANCE" | "INVALID_IMAGE" | TransportError["code"]; message: string }>;
export type LogoUploadError = Readonly<{ code: "UNSUPPORTED_FORMAT" | "FILE_TOO_HEAVY" | "DIMENSIONS_TOO_LARGE" | "UPLOAD_FAILED"; message: string }>;

export type StoreAppearanceApi = Readonly<{
  get: () => Promise<Result<StoreAppearanceState, TransportError>>;
  save: (body: SaveStoreAppearanceBody) => Promise<Result<Extract<StoreAppearanceState, { kind: "readable" }>, SaveStoreAppearanceError>>;
}>;
export type LogoFiles = Readonly<{
  convertToJpeg: (asset: LogoAsset) => Promise<Result<string, Readonly<{ message: string }>>>;
  upload: (uri: string, mimeType: string) => Promise<Result<Readonly<{ id: string; url: string }>, UploadImageError>>;
}>;

/** What buyers see for an unknown stored theme, and where the editor starts. */
export const unknownThemeStart: StoreAppearanceDraft = { theme: defaultStoreTheme, logo: null };

export const sameDraft = (a: StoreAppearanceDraft, b: StoreAppearanceDraft) => a.theme === b.theme && (a.logo?.id ?? null) === (b.logo?.id ?? null);

const rejection = {
  format: { code: "UNSUPPORTED_FORMAT", message: "Unsupported logo format" },
  size: { code: "FILE_TOO_HEAVY", message: "Logo file is too heavy" },
  dimensions: { code: "DIMENSIONS_TOO_LARGE", message: "Logo dimensions are too large" },
} as const satisfies Record<string, LogoUploadError>;

/** The server's answer for a file the pre-checks let through: 413 is the dimension limit (the byte limit was checked before). */
function uploadFailure(error: UploadImageError): LogoUploadError {
  if (error.code === "IMAGE_TOO_LARGE") return rejection.dimensions;
  if (error.code === "INVALID_IMAGE" || error.code === "UNSUPPORTED_MEDIA_TYPE") return rejection.format;
  return { code: "UPLOAD_FAILED", message: error.message };
}

export function createStoreAppearanceOperations(deps: Readonly<{ api: StoreAppearanceApi; logo: LogoFiles }>) {
  return {
    loadStoreAppearance: () => deps.api.get(),
    /** The `PUT` response is the new baseline: no `GET` follows. */
    saveStoreAppearance: (body: SaveStoreAppearanceBody) => deps.api.save(body),
    async uploadStoreLogo(asset: LogoAsset): Promise<Result<Readonly<{ id: string; url: string }>, LogoUploadError>> {
      const decision = decideLogoAsset(asset);
      if (decision.kind === "rejected") return err(rejection[decision.reason]);
      let uri = asset.uri;
      const mimeType: string = decision.kind === "upload_as_is" ? decision.mimeType : "image/jpeg";
      if (decision.kind === "convert_to_jpeg") {
        const converted = await deps.logo.convertToJpeg(asset);
        if (!converted.success) return err({ code: "UPLOAD_FAILED", message: converted.error.message });
        uri = converted.data;
      }
      const uploaded = await deps.logo.upload(uri, mimeType);
      return uploaded.success ? ok(uploaded.data) : err(uploadFailure(uploaded.error));
    },
  };
}
export type StoreAppearanceOperations = ReturnType<typeof createStoreAppearanceOperations>;
