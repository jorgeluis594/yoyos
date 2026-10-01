import type { OrderCustomer, OrderId, OrderItemId, PaymentId, ContactId, CompanyId, UserId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { AgencyRecipient, OrderAggregate, OrderLifecycle, Recipient } from "@core/src/features/orders/domain/order-state-machine";
import type { Currency } from "@shared/money";
import type { VariantId } from "@core/src/features/products/domain/product";

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

export type OrderContracts = [
  Assert<Equal<OrderId extends OrderItemId ? true : false, false>>,
  Assert<Equal<OrderId extends PaymentId ? true : false, false>>,
  Assert<Equal<PaymentId extends OrderId ? true : false, false>>,
  Assert<Equal<ContactId extends CompanyId ? true : false, false>>,
  Assert<Equal<UserId extends VariantId ? true : false, false>>,
  Assert<Equal<{ kind: "contact"; contactId: ContactId } extends OrderCustomer ? true : false, false>>,
  Assert<Equal<number extends PositiveInteger ? true : false, false>>,
  Assert<Equal<[] extends OrderAggregate["items"] ? true : false, false>>,
  Assert<Equal<OrderAggregate["total"]["currency"], Currency>>,
  Assert<Equal<AgencyRecipient["identity"], Extract<Recipient["identity"], { kind: "document" }>>>,
  Assert<Equal<{ kind: "document"; documentType: "passport" } extends Recipient["identity"] ? true : false, false>>,
  Assert<Equal<Extract<OrderLifecycle, { status: "completed" }>["completedAt"], Date>>,
  Assert<Equal<Extract<OrderLifecycle, { status: "active" | "cancelled" }>["completedAt"], null>>,
];
