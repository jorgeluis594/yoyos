import type { ShareLinkQrRequest } from "@shared/contracts/whatsapp-link-qr";
import { ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;

export function createLinkQrApi(request: Request) {
  return {
    async share(qr: Readonly<{ value: string; expiresAt: number }> | null): Promise<Result<void, TransportError>> {
      const body: ShareLinkQrRequest = { version: 1, qr: qr ? { value: qr.value, expiresAt: new Date(qr.expiresAt).toISOString() } : null };
      const result = await request("/api/whatsapp-link/qr", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return result.success ? ok(undefined) : result;
    },
  } as const;
}
