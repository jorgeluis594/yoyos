import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { parseDispatchSender, resolveDispatchSender, type ConfiguredDispatchSender, type DispatchSenderState, type InvalidDispatchSender } from "@core/src/features/dispatch-sender/domain/dispatch-sender";

export type DispatchSenderFailure = Readonly<{ code: "COMPANY_NOT_FOUND" | "INVALID_STORED_DATA" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type StoredDispatchSender = Readonly<{ companyName: string; sender: ConfiguredDispatchSender | null }>;

export type GetDispatchSenderDependencies = Readonly<{
  load: (companyId: string) => Promise<Result<StoredDispatchSender | null, DispatchSenderFailure>>;
}>;
export type SaveDispatchSenderDependencies = GetDispatchSenderDependencies & Readonly<{
  save: (companyId: string, sender: ConfiguredDispatchSender) => Promise<Result<null, DispatchSenderFailure>>;
}>;

/** Reads the configured sender and the effective one for the company's current name. */
export async function getDispatchSender(companyId: string, deps: GetDispatchSenderDependencies): Promise<Result<DispatchSenderState, DispatchSenderFailure>> {
  const loaded = await deps.load(companyId);
  if (!loaded.success) return loaded;
  if (!loaded.data) return err({ code: "COMPANY_NOT_FOUND", message: "Company not found" });
  return ok(resolveDispatchSender(loaded.data.companyName, loaded.data.sender));
}

/** Saves the sender on its own: it has no version and never conflicts with the delivery settings. */
export async function saveDispatchSender(companyId: string, value: unknown, deps: SaveDispatchSenderDependencies): Promise<Result<DispatchSenderState, DispatchSenderFailure | InvalidDispatchSender>> {
  const parsed = parseDispatchSender(value);
  if (!parsed.success) return parsed;
  const saved = await deps.save(companyId, parsed.data);
  if (!saved.success) return saved;
  return getDispatchSender(companyId, deps);
}
