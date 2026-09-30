import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { createInMemoryEventBus } from "@core/src/shared/events/infrastructure/in-memory-provider";
import type { EventHandler, EventSubscription } from "@core/src/shared/events/application/contracts";

type Events = { "order.completed": { orderId: string } };
const payload = { companyId: "company-a", orderId: "order-a" };
const metadata = { eventId: "event-a", occurredAt: "2026-09-30T12:00:00.000Z" };

function subscription(id: string, handler: EventHandler<Events, "order.completed"> = vi.fn(async () => ok(undefined))): EventSubscription<Events, "order.completed"> {
  return { id, name: "order.completed", handler, policy: {
    retries: 4, retryDelaySeconds: 5, exponentialBackoff: true, concurrency: 1,
  }, parsePayload: input => ok(input as typeof payload) };
}

describe("in-memory event bus", () => {
  it("delivers metadata and payload and awaits every handler despite a failure", async () => {
    const bus = createInMemoryEventBus<Events>();
    const failing = vi.fn(async () => err({ code: "FAILED", message: "failed", retryable: false }));
    const working = vi.fn(async () => ok(undefined));
    await bus.subscribe(subscription("one", failing));
    await bus.subscribe(subscription("two", working));
    expect(await bus.publish("order.completed", payload, metadata)).toEqual(
      err({ code: "EVENT_BUS_UNAVAILABLE", message: "failed" }),
    );
    expect(failing).toHaveBeenCalledWith(payload, metadata, expect.objectContaining({ attempt: 1 }));
    expect(working).toHaveBeenCalledOnce();
  });

  it("rejects duplicate IDs and removes only the local subscription", async () => {
    const bus = createInMemoryEventBus<Events>();
    const first = vi.fn(async () => ok(undefined));
    const second = vi.fn(async () => ok(undefined));
    const registered = await bus.subscribe(subscription("one", first));
    expect(await bus.subscribe(subscription("one", second))).toEqual(
      err({ code: "INVALID_SUBSCRIPTION", message: "Handler ID must be unique and nonempty" }),
    );
    expect(registered.success).toBe(true);
    if (registered.success) await registered.data();
    expect(await bus.publish("order.completed", payload, metadata)).toEqual(ok(undefined));
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});
