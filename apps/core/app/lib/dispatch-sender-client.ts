import { dispatchSenderResponseSchema, type DispatchSenderResponse } from "@shared/contracts/dispatch-sender";

export type SenderDraft = Readonly<{ name: string; phone: string }>;
export type SaveSenderResult = Readonly<{ kind: "saved"; sender: DispatchSenderResponse }> | Readonly<{ kind: "failed" }>;

export const senderEndpoint = "/api/company/dispatch-sender";

/** The sender is saved on its own endpoint: it has no version, so it never conflicts with the delivery settings. */
export async function saveSender(draft: SenderDraft, send: typeof fetch = fetch): Promise<SaveSenderResult> {
  try {
    const response = await send(senderEndpoint, { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: draft.name.trim() || null, phone: draft.phone.trim() || null }) });
    if (!response.ok) return { kind: "failed" };
    const parsed = dispatchSenderResponseSchema.safeParse(await response.json());
    return parsed.success ? { kind: "saved", sender: parsed.data } : { kind: "failed" };
  } catch { return { kind: "failed" }; }
}
