import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { ProductId } from "@core/src/features/products/domain/product";
import type { ClaimedNotice } from "@core/src/features/orders/infrastructure/chat-message-notice-repository";
import { noticeReferences, renderSellerNotice, type NoticeLocale, type NoticeProductNames, type RenderedSellerNotice } from "@core/src/features/orders/presentation/seller-notice-texts";

type PersistenceError = Readonly<{ code: string; message: string }>;

export type DescribeChatMessageNoticeDependencies = Readonly<{
  companyId: () => string;
  findOrderNumbers: (ids: readonly OrderId[]) => Promise<Result<ReadonlyMap<OrderId, number>, PersistenceError>>;
  findProductNames: (ids: readonly ProductId[]) => Promise<Result<ReadonlyMap<ProductId, NoticeProductNames>, PersistenceError>>;
}>;

/**
 * Writes the claimed notice in the device's language. Order numbers and product names come from the ids the notice
 * carries, read now: «del pedido #N» names the order the message was applied to, not the chat's current one.
 */
export async function describeChatMessageNotice(
  claim: ClaimedNotice,
  locale: NoticeLocale,
  deps: DescribeChatMessageNoticeDependencies,
): Promise<Result<RenderedSellerNotice, PersistenceError>> {
  const { orderIds, productIds } = noticeReferences(claim.notice);
  const [orderNumbers, products] = await Promise.all([deps.findOrderNumbers(orderIds), deps.findProductNames(productIds)]);
  if (!orderNumbers.success) return err(orderNumbers.error);
  if (!products.success) return err(products.error);
  return ok(renderSellerNotice(claim.notice, locale, {
    companyId: deps.companyId(), messageId: claim.messageId, chatId: claim.chatId, names: { orderNumbers: orderNumbers.data, products: products.data },
  }));
}
