import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { createPublishEvent } from "@core/src/composition/event-bus";
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
