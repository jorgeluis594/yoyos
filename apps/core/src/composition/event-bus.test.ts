import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";

const { providerPublish } = vi.hoisted(() => ({ providerPublish: vi.fn() }));
vi.mock("@core/src/shared/events/infrastructure/pg-boss-provider", () => ({ createPgBossProvider: () => ({ publish: providerPublish }) }));
vi.mock("@core/src/composition/event-handlers", () => ({ eventHandlers: {} }));

import { createEventBusRuntime, createPublishEvent } from "@core/src/composition/event-bus";
import type { EventPublisher } from "@core/src/shared/events/application/contracts";

type Events = { "order.completed": { orderId: string } };
const payload = { companyId: "company-a", orderId: "order-a" };

describe("publishEvent", () => {
  it("passes controlled metadata and waits for the publisher result", async () => {
    let finish!: (value: Awaited<ReturnType<EventPublisher<Events>["publish"]>>) => void;
    const publish = vi.fn(() => new Promise<Awaited<ReturnType<EventPublisher<Events>["publish"]>>>(resolve => { finish = resolve; }));
    const send = createPublishEvent<Events>({ publish }, () => "event-a", () => new Date("2026-09-30T12:00:00Z"));
    let settled = false;
    const pending = send("order.completed", payload).then(result => { settled = true; return result; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(publish).toHaveBeenCalledWith("order.completed", payload, {
      eventId: "event-a", occurredAt: "2026-09-30T12:00:00.000Z",
    });
    const failure = err({ code: "EVENT_BUS_UNAVAILABLE" as const, message: "database down" });
    finish(failure);
    expect(await pending).toEqual(failure);
  });

  it("fails when no publisher is configured", async () => {
    expect(await createPublishEvent<Events>()("order.completed", payload)).toEqual(
      err({ code: "EVENT_BUS_UNAVAILABLE", message: "Event bus is not configured" }),
    );
  });

  it("returns publisher success", async () => {
    const send = createPublishEvent<Events>({ publish: async () => ok(undefined) });
    expect(await send("order.completed", payload)).toEqual(ok(undefined));
  });
});

describe("createEventBusRuntime", () => {
  const orderPayload = { companyId: "company-a", orderId: "order-a" };
  const expectedFields = (fields: unknown) => {
    expect(fields).toMatchObject({ event: "event_publication_failed", name: "order_cancelled", companyId: "company-a",
      eventId: expect.any(String), occurredAt: expect.any(String) });
    expect(fields).not.toHaveProperty("orderId");
  };

  it("logs one publication failure with only bus fields when the provider fails", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const failure = err({ code: "EVENT_BUS_UNAVAILABLE" as const, message: "database down" });
    providerPublish.mockResolvedValueOnce(failure);
    try {
      expect(await createEventBusRuntime().publishEvent("order_cancelled", orderPayload as never)).toEqual(failure);
      expect(error).toHaveBeenCalledOnce();
      const [fields] = error.mock.calls[0]!;
      expectedFields(fields);
      expect(Object.keys(fields as object).sort()).toEqual(["companyId", "errorCode", "event", "eventId", "name", "occurredAt"]);
      expect(fields).toMatchObject({ errorCode: "EVENT_BUS_UNAVAILABLE" });
    } finally { error.mockRestore(); }
  });

  it("logs the thrown error and returns EVENT_BUS_UNAVAILABLE when the provider throws", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const cause = new Error("connection reset");
    providerPublish.mockRejectedValueOnce(cause);
    try {
      expect(await createEventBusRuntime().publishEvent("order_cancelled", orderPayload as never))
        .toEqual(err({ code: "EVENT_BUS_UNAVAILABLE", message: "Event publication failed" }));
      expect(error).toHaveBeenCalledOnce();
      const [fields] = error.mock.calls[0]!;
      expectedFields(fields);
      expect(Object.keys(fields as object).sort()).toEqual(["companyId", "err", "event", "eventId", "name", "occurredAt"]);
      expect(fields).toMatchObject({ err: cause });
    } finally { error.mockRestore(); }
  });
});
