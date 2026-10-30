import { describe, expect, test } from "vitest";
import { buildReadingContext, type ReadingContextInput } from "@core/src/features/orders/application/reading-context";
import type { ChatOrderTarget } from "@core/src/features/orders/domain/chat-order-target";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { OrderId } from "@core/src/features/orders/domain/order";
import { pending } from "@core/src/features/orders/infrastructure/chat-reading-fixtures";

const base: ReadingContextInput = { kind: "text", text: "hola", target: { kind: "none" }, pendings: [], shown: [], productIds: [], found: [], truncated: false, maxItems: 40 };
const context = (target: ChatOrderTarget, over: Partial<ReadingContextInput> = {}) => buildReadingContext({ ...base, target, ...over });

describe("buildReadingContext", () => {
  test.each<[string, ChatOrderTarget, "open" | "closed" | "none"]>([
    ["an open order", { kind: "open", order: { id: "o1", items: [] } as unknown as OrderAggregate, productIds: new Map() }, "open"],
    ["a closed order", { kind: "closed", orderId: "o1" as OrderId, number: 1023 as OrderNumber }, "closed"],
    ["a cancelled order", { kind: "cancelled" }, "none"],
    ["no order", { kind: "none" }, "none"],
  ])("sets the latest order from %s", (_title, target, latestOrder) => {
    expect(context(target).latestOrder).toBe(latestOrder);
  });

  test("starts with no photo just sent and no line marked", () => {
    const built = context({ kind: "none" }, { pendings: [pending(1, {})] });
    expect(built.photoJustSent).toBeNull();
    expect(built.pendings).toMatchObject([{ ref: "Q1", photoJustSent: false }]);
  });
});
