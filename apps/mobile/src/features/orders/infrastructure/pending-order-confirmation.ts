import { completeOrderSchema } from "@shared/contracts/orders";
import { z } from "zod";
import { currencies } from "@shared/money";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { PendingOrderConfirmation, PendingOrderStoreError } from "@mobile/features/orders/application/order-operations";

const pendingSchema = z.strictObject({
  companyId: z.uuid(), id: z.uuid(),
  shownTotal: z.strictObject({ amount: z.number().positive().finite(), currency: z.enum(currencies) }),
  version: z.literal(2), request: completeOrderSchema,
  rejection: z.strictObject({ code: z.string().min(1).max(64), message: z.string().max(500), variantId: z.uuid().optional() }).optional(),
  itemLabels: z.record(z.uuid(), z.string().max(200)).optional(),
}).refine(value => value.request.id === value.id, { message: "Pending order identity mismatch" });
const indexSchema = z.array(z.uuid());

type Storage = Readonly<{
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}>;
type StoreResult<T> = Promise<Result<T, PendingOrderStoreError>>;

const unavailable = (message: string) => err({ code: "PENDING_STORAGE_UNAVAILABLE" as const, message });
const invalid = (message = "Invalid pending order") => err({ code: "INVALID_PENDING_DATA" as const, message });

/**
 * Company-scoped queue of sales waiting to reach core. Each sale has its own key plus a per-company index;
 * an entry is written before it joins the index and leaves the index before it is deleted, so the index
 * never points to a sale that was not stored.
 */
export function createPendingOrderConfirmationStore(storage: Storage) {
  const indexKey = (companyId: string) => `yoyos_pending_orders_${companyId}`;
  const entryKey = (companyId: string, id: string) => `yoyos_pending_order_${companyId}_${id}`;
  // Before the queue each company kept one sale under this key; it joins the queue on first read.
  const legacyKey = (companyId: string) => `yoyos_pending_order_${companyId}`;
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work);
    tail = next.catch(() => undefined);
    return next;
  };
  const get = async (key: string): StoreResult<unknown | null> => {
    let raw: string | null;
    try { raw = await storage.getItemAsync(key); }
    catch { return unavailable("Cannot read pending order"); }
    if (raw === null) return ok(null);
    try { const value: unknown = JSON.parse(raw); return ok(value); }
    catch { return invalid(); }
  };
  const set = async (key: string, value: unknown): StoreResult<void> => {
    try { await storage.setItemAsync(key, JSON.stringify(value)); return ok(undefined); }
    catch { return unavailable("Cannot save pending order"); }
  };
  const remove = async (key: string): StoreResult<void> => {
    try { await storage.deleteItemAsync(key); return ok(undefined); }
    catch { return unavailable("Cannot clear pending order"); }
  };
  const parseEntry = (companyId: string, value: unknown): Result<PendingOrderConfirmation, PendingOrderStoreError> => {
    const parsed = pendingSchema.safeParse(value);
    return parsed.success && parsed.data.companyId === companyId ? ok(parsed.data) : invalid();
  };
  const readIndex = async (companyId: string): StoreResult<string[]> => {
    const stored = await get(indexKey(companyId));
    if (!stored.success) return stored;
    if (stored.data === null) return ok([]);
    const parsed = indexSchema.safeParse(stored.data);
    return parsed.success ? ok(parsed.data) : invalid("Invalid pending order index");
  };
  const migrateLegacy = async (companyId: string, ids: string[]): StoreResult<string[]> => {
    const legacy = await get(legacyKey(companyId));
    if (!legacy.success || legacy.data === null) return legacy.success ? ok(ids) : legacy;
    const entry = parseEntry(companyId, legacy.data);
    if (!entry.success) return entry;
    const next = ids.includes(entry.data.id) ? ids : [...ids, entry.data.id];
    for (const step of [() => set(entryKey(companyId, entry.data.id), entry.data), () => set(indexKey(companyId), next), () => remove(legacyKey(companyId))]) {
      const done = await step();
      if (!done.success) return done;
    }
    return ok(next);
  };
  const ids = async (companyId: string): StoreResult<string[]> => {
    const index = await readIndex(companyId);
    return index.success ? migrateLegacy(companyId, index.data) : index;
  };
  const readEntry = async (companyId: string, id: string): StoreResult<PendingOrderConfirmation | null> => {
    const stored = await get(entryKey(companyId, id));
    if (!stored.success || stored.data === null) return stored.success ? ok(null) : stored;
    const entry = parseEntry(companyId, stored.data);
    return entry.success && entry.data.id !== id ? invalid() : entry;
  };
  const list = async (companyId: string): StoreResult<PendingOrderConfirmation[]> => {
    const known = await ids(companyId);
    if (!known.success) return known;
    const entries: PendingOrderConfirmation[] = [];
    for (const id of known.data) {
      const entry = await readEntry(companyId, id);
      if (!entry.success) return entry;
      if (entry.data) entries.push(entry.data);
    }
    return ok(entries);
  };
  const read = async (companyId: string, id: string): StoreResult<PendingOrderConfirmation | null> => {
    const known = await ids(companyId);
    if (!known.success) return known;
    return known.data.includes(id) ? readEntry(companyId, id) : ok(null);
  };
  return {
    list: (companyId: string) => exclusive(() => list(companyId)),
    read: (companyId: string, id: string) => exclusive(() => read(companyId, id)),
    save: (pending: PendingOrderConfirmation) => exclusive(async (): StoreResult<PendingOrderConfirmation> => {
      const parsed = pendingSchema.safeParse(pending);
      if (!parsed.success) return invalid();
      const known = await ids(pending.companyId);
      if (!known.success) return known;
      if (known.data.includes(pending.id)) {
        const existing = await readEntry(pending.companyId, pending.id);
        if (!existing.success) return existing;
        if (existing.data) return ok(existing.data);
      }
      const stored = await set(entryKey(pending.companyId, pending.id), parsed.data);
      if (!stored.success) return stored;
      const indexed = known.data.includes(pending.id) ? ok(undefined) : await set(indexKey(pending.companyId), [...known.data, pending.id]);
      return indexed.success ? ok(parsed.data) : indexed;
    }),
    replace: (previous: PendingOrderConfirmation, next: PendingOrderConfirmation) => exclusive(async (): StoreResult<PendingOrderConfirmation> => {
      const parsed = pendingSchema.safeParse(next);
      if (!parsed.success || next.companyId !== previous.companyId || next.id !== previous.id) return invalid("Invalid replacement attempt");
      const existing = await read(previous.companyId, previous.id);
      if (!existing.success) return existing;
      if (JSON.stringify(existing.data) !== JSON.stringify(previous))
        return err({ code: "PENDING_CONFIRMATION", message: "Pending attempt changed before review" });
      const stored = await set(entryKey(previous.companyId, previous.id), parsed.data);
      return stored.success ? ok(parsed.data) : stored;
    }),
    clear: (companyId: string, id: string) => exclusive(async (): StoreResult<void> => {
      const known = await ids(companyId);
      if (!known.success) return known;
      if (!known.data.includes(id)) return ok(undefined);
      const indexed = await set(indexKey(companyId), known.data.filter(known => known !== id));
      if (!indexed.success) return indexed;
      await remove(entryKey(companyId, id)); // an orphaned entry outside the index is never read
      return ok(undefined);
    }),
    /** Drops unreadable sales so the readable ones can still be sent. */
    discard: (companyId: string) => exclusive(async (): StoreResult<void> => {
      const legacy = await get(legacyKey(companyId));
      if (!legacy.success && legacy.error.code === "PENDING_STORAGE_UNAVAILABLE") return legacy;
      if (!legacy.success || (legacy.data !== null && !parseEntry(companyId, legacy.data).success)) {
        const removed = await remove(legacyKey(companyId));
        if (!removed.success) return removed;
      }
      const index = await readIndex(companyId);
      if (!index.success && index.error.code === "PENDING_STORAGE_UNAVAILABLE") return index;
      const kept: string[] = [];
      for (const id of index.success ? index.data : []) {
        const entry = await readEntry(companyId, id);
        if (!entry.success && entry.error.code === "PENDING_STORAGE_UNAVAILABLE") return entry;
        if (entry.success && entry.data) kept.push(id);
      }
      return set(indexKey(companyId), kept);
    }),
  };
}
