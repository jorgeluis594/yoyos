import { legacyCompleteOrderSchema, createRatedOrderSchema } from "@shared/contracts/orders";
import { z } from "zod";
import { currencies } from "@shared/money";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { PendingOrderConfirmation, PendingOrderStoreError } from "@mobile/features/orders/application/order-operations";

const legacyPendingSchema = z.strictObject({
  companyId: z.uuid(), id: z.uuid(),
  shownTotal: z.strictObject({ amount: z.number().positive().finite(), currency: z.enum(currencies) }),
});

const pendingSchema = z.union([legacyPendingSchema.extend({ version: z.literal(2), request: z.union([createRatedOrderSchema, legacyCompleteOrderSchema]) })
  .refine(value => value.request.id === value.id, { message: "Pending order identity mismatch" }), legacyPendingSchema]);

type Storage = Readonly<{
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}>;

export function createPendingOrderConfirmationStore(storage: Storage) {
  const key = (companyId: string) => `yoyos_pending_order_${companyId}`;
  const read = async (companyId: string): Promise<Result<PendingOrderConfirmation | null, PendingOrderStoreError>> => {
    let raw: string | null;
    try { raw = await storage.getItemAsync(key(companyId)); }
    catch { return err({ code: "PENDING_STORAGE_UNAVAILABLE", message: "Cannot read pending order" }); }
    if (raw === null) return ok(null);
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { return err({ code: "INVALID_PENDING_DATA", message: "Invalid pending order" }); }
    const parsed = pendingSchema.safeParse(value);
    return parsed.success && parsed.data.companyId === companyId
      ? ok(parsed.data) : err({ code: "INVALID_PENDING_DATA", message: "Invalid pending order" });
  };
  return {
    read,
    replace: async (previous: PendingOrderConfirmation, next: PendingOrderConfirmation): Promise<Result<PendingOrderConfirmation, PendingOrderStoreError>> => {
      const parsed = pendingSchema.safeParse(next);
      if (!parsed.success || next.companyId !== previous.companyId || next.id !== previous.id)
        return err({ code: "INVALID_PENDING_DATA", message: "Invalid replacement attempt" });
      const existing = await read(previous.companyId);
      if (!existing.success) return existing;
      if (JSON.stringify(existing.data) !== JSON.stringify(previous))
        return err({ code: "PENDING_CONFIRMATION", message: "Pending attempt changed before review" });
      try { await storage.setItemAsync(key(previous.companyId), JSON.stringify(parsed.data)); }
      catch { return err({ code: "PENDING_STORAGE_UNAVAILABLE", message: "Cannot save reviewed attempt" }); }
      return ok(parsed.data);
    },
    save: async (pending: PendingOrderConfirmation): Promise<Result<PendingOrderConfirmation, PendingOrderStoreError>> => {
      const parsed = pendingSchema.safeParse(pending);
      if (!parsed.success) return err({ code: "INVALID_PENDING_DATA", message: "Invalid pending order" });
      const existing = await read(pending.companyId);
      if (!existing.success) return existing;
      if (existing.data) return existing.data.id === pending.id ? ok(existing.data)
        : err({ code: "PENDING_CONFIRMATION", message: "Another order needs verification" });
      try { await storage.setItemAsync(key(pending.companyId), JSON.stringify(parsed.data)); }
      catch { return err({ code: "PENDING_STORAGE_UNAVAILABLE", message: "Cannot save pending order" }); }
      return ok(parsed.data);
    },
    clear: async (companyId: string, id: string): Promise<Result<void, PendingOrderStoreError>> => {
      const existing = await read(companyId);
      if (!existing.success) return existing;
      if (!existing.data) return ok(undefined);
      if (existing.data.id !== id) return err({ code: "PENDING_CONFIRMATION", message: "Another order needs verification" });
      try { await storage.deleteItemAsync(key(companyId)); }
      catch { return err({ code: "PENDING_STORAGE_UNAVAILABLE", message: "Cannot clear pending order" }); }
      return ok(undefined);
    },
  };
}
