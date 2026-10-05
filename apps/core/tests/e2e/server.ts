import { err, ok } from "@shared/functional";
import { startServer } from "@core/src/server";

// Only the cost capability is controlled. Auth, configuration, snapshots and persistence remain real.
await startServer(async (delivery, _context, currency) => delivery.recipient.name === "Unavailable"
  ? err({ code: "DELIVERY_UNAVAILABLE", reason: "availability_unconfirmed", message: "Unavailable in this test" })
  : ok({ amount: 3, currency }));
