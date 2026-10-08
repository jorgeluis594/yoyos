import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { applicationEventBus } from "@core/src/composition/event-bus";
import { dispatchMessageRecorded } from "@core/src/features/chats/infrastructure/mobile-message-dispatch";
import type { WhatsAppMessageRecorded } from "@core/src/features/chats/application/events";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

const companyId = randomUUID() as WhatsAppMessageRecorded["companyId"];
const messageId = randomUUID() as WhatsAppMessageRecorded["messageId"];
const payload = { companyId, messageId };
const metadata = { eventId: messageId, occurredAt: "2026-10-08T12:00:00.456Z" };

test("validates message event and tenant even when the provider has no subscribers", async () => {
  const publish = vi.spyOn(applicationEventBus().provider, "publish").mockResolvedValue(ok(undefined));
  try {
    expect(await withTenantIsolation(companyId, () => dispatchMessageRecorded(payload, metadata))).toEqual(ok(undefined));
    expect(publish).toHaveBeenCalledWith("whatsapp_message_recorded", payload, metadata);
    for (const invalid of [
      { ...payload, companyId: randomUUID() as typeof companyId },
      { ...payload, messageId: "invalid" as typeof messageId },
      { ...payload, extra: "private" },
    ]) expect(await withTenantIsolation(companyId, () => dispatchMessageRecorded(invalid, metadata)))
      .toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
    expect(await withTenantIsolation(companyId, () => dispatchMessageRecorded(payload, { ...metadata, eventId: randomUUID() })))
      .toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
    for (const invalid of [
      { ...metadata, occurredAt: "invalid" },
      { eventId: messageId },
      { ...metadata, extra: "private" },
    ]) expect(await withTenantIsolation(companyId, () => dispatchMessageRecorded(payload, invalid as typeof metadata)))
      .toMatchObject({ success: false, error: { code: "INVALID_EVENT", message: "Invalid message event" } });
    expect(await dispatchMessageRecorded(payload, metadata)).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
    expect(publish).toHaveBeenCalledTimes(1);
  } finally { publish.mockRestore(); }
});
