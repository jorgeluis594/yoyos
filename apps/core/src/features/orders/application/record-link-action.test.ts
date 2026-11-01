import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import type { CompanyId, OrderId, UserId } from "@core/src/features/orders/domain/order";
import type { OrderLinkActionId } from "@core/src/features/orders/domain/order-review";
import { recordLinkAction } from "@core/src/features/orders/application/record-link-action";

const access = { companyId: "c" as CompanyId, userId: "u" as UserId };
const input = { id: "a" as OrderLinkActionId, orderId: "o" as OrderId, action: "copy" as const };
const at = new Date("2026-10-31T12:00:00Z");

test("stores the link action with the user and the time", async () => {
  const saveLinkAction = vi.fn(async () => ok(null));
  expect(await recordLinkAction(input, access, { orderExists: async () => ok(true), saveLinkAction, clock: () => at })).toEqual(ok(null));
  expect(saveLinkAction).toHaveBeenCalledWith({ id: "a", orderId: "o", userId: "u", action: "copy", reviewId: null, takenAt: at });
});

test("answers not found for an order of another company", async () => {
  const saveLinkAction = vi.fn(async () => ok(null));
  expect(await recordLinkAction(input, access, { orderExists: async () => ok(false), saveLinkAction, clock: () => at })).toMatchObject({ success: false, error: { code: "ORDER_NOT_FOUND" } });
  expect(saveLinkAction).not.toHaveBeenCalled();
});
