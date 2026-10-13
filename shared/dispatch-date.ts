import type { Result } from "@shared/result";

/** Calendar day (YYYY-MM-DD) a dispatch is scheduled for; not an instant. */
export type DispatchDate = string & { readonly __brand: "DispatchDate" };

export function parseDispatchDate(value: unknown): Result<DispatchDate> {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)) return { success: true, data: value as DispatchDate };
  }
  return { success: false, error: { message: "Invalid dispatch date", code: "INVALID_DISPATCH_DATE" } };
}
