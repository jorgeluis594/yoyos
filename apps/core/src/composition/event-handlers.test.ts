import { parseMessageCreated } from "@core/src/features/chats/infrastructure/event-payloads";
import { parseOrderCancelled } from "@core/src/features/orders/infrastructure/event-payloads";
import { eventHandlers } from "@core/src/composition/event-handlers";
import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { bootstrapEventHandlers, defineEventHandler } from "@core/src/composition/event-handlers";
import type { EventSubscriber } from "@core/src/shared/events/application/contracts";

type Events = { "order.completed": { orderId: string } };
const handler = defineEventHandler<Events, "order.completed">("order.completed", async () => ok(undefined), {
  id: "receipt", parsePayload: input => ok(input as { companyId: string; orderId: string }),
});

describe("handler bootstrap", () => {
  it("registers once across concurrent calls and cleans up once", async () => {
    const unsubscribe = vi.fn(async () => ok(undefined));
    const subscribe = vi.fn(async () => ok(unsubscribe));
    const bootstrap = bootstrapEventHandlers<Events>({ subscribe } as EventSubscriber<Events>, [handler]);
    const [first, second] = await Promise.all([bootstrap(), bootstrap()]);
    expect(first.success && second.success).toBe(true);
    expect(subscribe).toHaveBeenCalledOnce();
    if (first.success) await first.data();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("cleans up partial registration on failure", async () => {
    const unsubscribe = vi.fn(async () => ok(undefined));
    const subscribe = vi.fn()
      .mockResolvedValueOnce(ok(unsubscribe))
      .mockResolvedValueOnce(err({ code: "INVALID_SUBSCRIPTION", message: "duplicate" }));
    const bootstrap = bootstrapEventHandlers<Events>({ subscribe } as EventSubscriber<Events>, [handler, { ...handler, id: "second" }]);
    expect(await bootstrap()).toEqual(err({ code: "INVALID_SUBSCRIPTION", message: "duplicate" }));
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});


it("registers stock restoration for the producer and worker and rejects invalid payloads", () => {
  expect(eventHandlers.filter(handler => handler.name === "order_cancelled").map(handler => handler.id)).toEqual(["restore-cancelled-order-stock"]);
  expect(parseOrderCancelled({ orderId: "invalid", companyId: "invalid" })).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
});

it("registers apply-chat-message for message_created, ordered by chat, with its dead-letter handler", () => {
  const registered = eventHandlers.filter(handler => handler.name === "message_created");
  expect(registered.map(handler => handler.id)).toEqual(["apply-chat-message"]);
  expect(registered[0].policy).toMatchObject({ concurrency: 16, retries: 8, groupConcurrency: 8, expireInSeconds: 90, heartbeatSeconds: 30,
    deadLetter: { id: "apply-chat-message-dead-letter", policy: { retries: 8, retryDelaySeconds: 30 } } });
  const payload = { companyId: "company", chatId: "chat", messageId: "message" } as never;
  expect(registered[0].policy.orderingKey?.(payload)).toBe("chat");
  expect(registered[0].policy.groupKey?.(payload)).toBe("company");
});

it("parses its payload with parseMessageCreated", () => {
  const registered = eventHandlers.find(handler => handler.id === "apply-chat-message");
  expect(registered?.parsePayload).toBe(parseMessageCreated);
  expect(registered?.parsePayload({ companyId: "invalid", messageId: "invalid" })).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
});

it("registers index-product-image for product_image_changed with concurrency 1 and 8 retries", () => {
  const registered = eventHandlers.filter(handler => handler.name === "product_image_changed");
  expect(registered.map(handler => handler.id)).toEqual(["index-product-image"]);
  expect(registered[0].policy).toMatchObject({ concurrency: 1, retries: 8 });
  expect(registered[0].parsePayload({ companyId: "x", productId: "y" })).toMatchObject({ success: false, error: { code: "INVALID_EVENT" } });
});
