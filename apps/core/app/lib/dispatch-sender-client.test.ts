import { expect, test, vi } from "vitest";
import { saveSender, senderEndpoint } from "@core/app/lib/dispatch-sender-client";

const configured = { configured: { name: "Fantastidog", phone: "977 000 111" }, effective: { name: "Fantastidog", phone: "977 000 111" } };

test("saving sends trimmed text with empty fields as null, to the sender endpoint only", async () => {
  const send = vi.fn().mockResolvedValue(new Response(JSON.stringify(configured), { status: 200 }));
  expect(await saveSender({ name: " Fantastidog ", phone: "  " }, send)).toEqual({ kind: "saved", sender: configured });
  expect(send).toHaveBeenCalledWith(senderEndpoint, expect.objectContaining({ method: "PUT", body: JSON.stringify({ name: "Fantastidog", phone: null }) }));
});

test("a rejected, unreadable or lost save is reported as failed so the seller can retry", async () => {
  expect(await saveSender({ name: "a", phone: "" }, vi.fn().mockResolvedValue(new Response("{}", { status: 503 })))).toEqual({ kind: "failed" });
  expect(await saveSender({ name: "a", phone: "" }, vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: 1 }), { status: 200 })))).toEqual({ kind: "failed" });
  expect(await saveSender({ name: "a", phone: "" }, vi.fn().mockRejectedValue(new TypeError("offline")))).toEqual({ kind: "failed" });
});
