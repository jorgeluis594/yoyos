import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { sellerNoticeTargetResponseSchema } from "@shared/contracts/seller-notices";
import type { TransportError } from "@mobile/shared/application/transport-error";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;

export function createSellerNoticeApi(request: Request) {
  return {
    /** The order an order notice points at; the notice's push never carries it. */
    resolveOrder: async (messageId: string): Promise<Result<string, TransportError>> => {
      const raw = await request(`/api/seller-notices/${encodeURIComponent(messageId)}`);
      if (!raw.success) return raw;
      const parsed = sellerNoticeTargetResponseSchema.safeParse(raw.data);
      if (!parsed.success || parsed.data.target.kind !== "order") return err({ code: "INVALID_RESPONSE", message: "Invalid seller notice response" });
      return ok(parsed.data.target.orderId);
    },
  };
}
