import { imageResponseSchema, type ImageResponse } from "@shared/contracts/images";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type UploadImageError = Readonly<{ code: string; message: string }>;

function failureCode(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "code" in payload && typeof payload.code === "string") return payload.code;
  return fallback;
}

export async function uploadImageFile(file: File): Promise<Result<ImageResponse, UploadImageError>> {
  const body = new FormData();
  body.set("file", file);
  let response: Response;
  try {
    response = await fetch("/api/images", { method: "POST", body });
  } catch {
    return err({ code: "IMAGE_UPLOAD_UNAVAILABLE", message: "Unable to reach the image service" });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return err({ code: "INVALID_IMAGE_RESPONSE", message: "Invalid image response" });
  }
  if (!response.ok) return err({ code: failureCode(payload, "IMAGE_UPLOAD_REJECTED"), message: "Image upload was rejected" });
  const parsed = imageResponseSchema.safeParse(payload);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_IMAGE_RESPONSE", message: "Invalid image response" });
}
