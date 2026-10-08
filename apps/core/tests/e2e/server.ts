import { err, ok } from "@shared/functional";
import { startServer } from "@core/src/server";
import { orders, setConfiguredOrderDelivery } from "@core/src/features/orders/composition";
import type { ResolveDeliveryDependencies } from "@core/src/features/orders/application/resolve-delivery-selection";

// Only the cost capability is controlled. Auth, configuration, snapshots and persistence remain real.
const resolveShippingCost: ResolveDeliveryDependencies["resolveShippingCost"] = async (delivery, _context, currency) => delivery.recipient.name === "Unavailable"
  ? err({ code: "DELIVERY_UNAVAILABLE", reason: "availability_unconfirmed", message: "Unavailable in this test" })
  : ok({ amount: 3, currency });
orders.setDelivery = (input, context) => setConfiguredOrderDelivery(input, context, resolveShippingCost);
await startServer(resolveShippingCost);
