import type { Order, OrderCustomer, OrderId, OrderItemId, ContactId, CompanyId, UserId, PositiveInteger } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

export type OrderContracts = [
  Assert<Equal<OrderId extends OrderItemId ? true : false, false>>,
  Assert<Equal<ContactId extends CompanyId ? true : false, false>>,
  Assert<Equal<UserId extends VariantId ? true : false, false>>,
  Assert<Equal<[] extends Order["items"] ? true : false, false>>,
  Assert<Equal<{ kind: "contact"; contactId: ContactId } extends OrderCustomer ? true : false, false>>,
  Assert<Equal<number extends PositiveInteger ? true : false, false>>,
  Assert<Equal<Order["paymentMethod"], "digital_wallet">>,
];
