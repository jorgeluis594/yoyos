import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { createDispatchLabelsResponseSchema, type CreateDispatchLabelsRequest, type CreateDispatchLabelsResponse } from "@shared/contracts/dispatch-labels";

/** Initial value, adjustable. */
export const dispatchLabelsTimeoutMs = 30_000;

export type DispatchLabelsRequestError = Readonly<{ code: "REQUEST_FAILED"; message: string }>;

/** A plain fetch with the session cookie, like the other panel clients; the endpoint only reads, so a retry is always safe. */
export async function requestDispatchLabels(request: CreateDispatchLabelsRequest, signal?: AbortSignal): Promise<Result<CreateDispatchLabelsResponse, DispatchLabelsRequestError>> {
  const timeout = AbortSignal.timeout(dispatchLabelsTimeoutMs);
  try {
    const response = await fetch("/api/dispatch-labels", { method: "POST", credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(request),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) return err({ code: "REQUEST_FAILED", message: `Dispatch labels answered ${response.status}` });
    const body = createDispatchLabelsResponseSchema.safeParse(await response.json());
    return body.success ? ok(body.data) : err({ code: "REQUEST_FAILED", message: "Dispatch labels answer is not valid" });
  } catch {
    return err({ code: "REQUEST_FAILED", message: "Dispatch labels could not be requested" });
  }
}

export function pdfBlobFromBase64(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "application/pdf" });
}
