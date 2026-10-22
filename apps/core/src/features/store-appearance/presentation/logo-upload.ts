import { imageResponseSchema, imageUploadLimits } from "@shared/contracts/images";

export const logoTypes = ["image/png", "image/jpeg", "image/webp"];

export type LogoUploadFailure = "type" | "size" | "dimensions" | "failed";

/**
 * Uploads a logo through the image API. The byte limit is checked first, with the limit the server uses,
 * so a 413 can only mean the dimensions.
 */
export async function uploadLogo(file: File, send: typeof fetch = fetch): Promise<{ id: string; url: string } | LogoUploadFailure> {
  if (!logoTypes.includes(file.type)) return "type";
  if (file.size > imageUploadLimits.maxBytes) return "size";
  const body = new FormData();
  body.append("file", file);
  try {
    const response = await send("/api/images", { method: "POST", body });
    if (response.status === 413) return "dimensions";
    const image = imageResponseSchema.safeParse(await response.json());
    return response.ok && image.success ? image.data : "failed";
  } catch {
    return "failed";
  }
}
