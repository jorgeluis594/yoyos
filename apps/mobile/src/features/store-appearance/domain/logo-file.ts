import { imageUploadLimits } from "@shared/contracts/images";

export type LogoAsset = Readonly<{
  mimeType?: string | null;
  fileName?: string | null;
  uri: string;
  fileSize: number;
  width: number;
  height: number;
  source: "library" | "camera";
}>;

export type LogoAssetDecision =
  | Readonly<{ kind: "upload_as_is"; mimeType: "image/png" | "image/jpeg" | "image/webp" }>
  | Readonly<{ kind: "convert_to_jpeg" }>
  | Readonly<{ kind: "rejected"; reason: "format" | "size" | "dimensions" }>;

type KnownType = "image/png" | "image/jpeg" | "image/webp" | "image/heic";

const byMime: Readonly<Record<string, KnownType>> = {
  "image/png": "image/png", "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg", "image/webp": "image/webp", "image/heic": "image/heic", "image/heif": "image/heic",
};
const byExtension: Readonly<Record<string, KnownType>> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic", heif: "image/heic" };

function extensionOf(name: string) {
  const path = name.split(/[?#]/)[0] ?? "";
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

/** The picker may omit the MIME type, so the file extension decides then. */
function typeOf(asset: LogoAsset): KnownType | null {
  const declared = asset.mimeType ? byMime[asset.mimeType.toLowerCase()] : undefined;
  if (declared) return declared;
  if (asset.mimeType) return null;
  return byExtension[extensionOf(asset.fileName ?? asset.uri)] ?? byExtension[extensionOf(asset.uri)] ?? null;
}

/** Pre-checks for user feedback only; core validates the bytes. PNG, JPG and WEBP are never altered, so they are accepted as chosen or rejected. */
export function decideLogoAsset(asset: LogoAsset): LogoAssetDecision {
  if (asset.source === "camera") return { kind: "convert_to_jpeg" };
  const type = typeOf(asset);
  if (!type) return { kind: "rejected", reason: "format" };
  if (type === "image/heic") return { kind: "convert_to_jpeg" };
  if (asset.fileSize > imageUploadLimits.maxBytes) return { kind: "rejected", reason: "size" };
  const { maxSide, maxPixels } = imageUploadLimits;
  if (Math.max(asset.width, asset.height) > maxSide || asset.width * asset.height > maxPixels) return { kind: "rejected", reason: "dimensions" };
  return { kind: "upload_as_is", mimeType: type };
}
