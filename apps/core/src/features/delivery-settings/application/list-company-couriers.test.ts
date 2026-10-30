import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { listCompanyCouriers } from "@core/src/features/delivery-settings/application/list-company-couriers";
import type { CourierId } from "@core/src/features/delivery-settings/domain/delivery-settings";

test("lists the couriers the store can have orders with, by name", async () => {
  const couriers = [{ id: "c1" as CourierId, name: "Shalom", enabled: false }];
  const read = vi.fn(async () => ok(couriers));
  expect(await listCompanyCouriers({ companyId: "company-1" }, read)).toEqual(ok(couriers));
  expect(read).toHaveBeenCalledWith("company-1");
});

test("returns a persistence failure instead of an empty list", async () => {
  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });
  expect(await listCompanyCouriers({ companyId: "company-1" }, async () => failure)).toEqual(failure);
});
