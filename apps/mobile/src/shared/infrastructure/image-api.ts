import { imageResponseSchema } from "@shared/contracts/images";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";

type UploadCode = "UNAUTHENTICATED" | "COMPANY_REQUIRED" | "NETWORK_ERROR" | "SERVICE_UNAVAILABLE" | "RATE_LIMITED" | "SERVER_ERROR" | "INVALID_RESPONSE" | "OPERATION_CANCELLED" | "SECURE_STORAGE_ERROR" | "API_ERROR"
  | "INVALID_IMAGE" | "IMAGE_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "IMAGE_STORAGE_UNAVAILABLE" | "ABORTED";
export type UploadImageError = Readonly<{ code: UploadCode; message: string; http?: Readonly<{ status: number }> }>;
type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;

const uploadCodes: readonly string[] = ["UNAUTHENTICATED", "COMPANY_REQUIRED", "NETWORK_ERROR", "SERVICE_UNAVAILABLE", "RATE_LIMITED", "SERVER_ERROR", "INVALID_RESPONSE", "OPERATION_CANCELLED", "SECURE_STORAGE_ERROR", "API_ERROR",
  "INVALID_IMAGE", "IMAGE_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "IMAGE_STORAGE_UNAVAILABLE"];
const expectedStatus: Readonly<Record<string, number>> = { INVALID_IMAGE: 400, IMAGE_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, IMAGE_STORAGE_UNAVAILABLE: 502 };
const extensions: Readonly<Record<string, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function failure(code: UploadCode, message: string): UploadImageError {
  return { code, message };
}

function readFailure(error: TransportError): UploadImageError {
  if (error.http?.status === 429) return failure("RATE_LIMITED", error.message);
  const http = error.http ? { http: { status: error.http.status } } : {};
  if (!uploadCodes.includes(error.code)) return { ...failure("API_ERROR", error.message), ...http };
  const status = expectedStatus[error.code];
  // A typed image error must come with its documented status; anything else is not a trustworthy answer.
  if (status !== undefined && error.http?.status !== status) return failure("INVALID_RESPONSE", "Server returned an invalid error");
  return { ...failure(error.code as UploadCode, error.message), ...http };
}

export type UploadImageOptions = Readonly<{ signal?: AbortSignal }>;

/** Uploads a local image to core with its real mimeType; the file is validated by core from its bytes. An aborted upload answers `ABORTED`, whatever the transport said. */
export async function uploadImage(request: Request, uri: string, mimeType: string, options: UploadImageOptions = {}): Promise<Result<Readonly<{ id: string; url: string }>, UploadImageError>> {
  let file: Blob;
  try {
    const source = await fetch(uri).then((response) => response.blob());
    file = new Blob([source], { type: mimeType });
  } catch {
    return err(failure("NETWORK_ERROR", "Could not prepare the photo"));
  }
  const form = new FormData();
  form.append("file", file, `image.${extensions[mimeType] ?? "bin"}`);
  if (options.signal?.aborted) return err(failure("ABORTED", "Upload aborted"));
  const result = await request("/api/images", { method: "POST", body: form, ...(options.signal ? { signal: options.signal } : {}) });
  if (options.signal?.aborted) return err(failure("ABORTED", "Upload aborted"));
  if (!result.success) return err(readFailure(result.error));
  const parsed = imageResponseSchema.safeParse(result.data);
  return parsed.success ? ok({ id: parsed.data.id, url: parsed.data.url }) : err(failure("INVALID_RESPONSE", "Server returned invalid image data"));
}
