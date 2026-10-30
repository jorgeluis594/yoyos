import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { ProductId, VariantId } from "@core/src/features/products/domain/product";

/** Why a chat has no order to change decides the outcome, so a missing order is not a bare null. */
export type ChatOrderTarget =
  | Readonly<{ kind: "open"; order: OrderAggregate; productIds: ReadonlyMap<VariantId, ProductId> }>
  | Readonly<{ kind: "closed"; orderId: OrderId; number: OrderNumber }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "none" }>;
