import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { ProductId } from "@core/src/features/products/domain/product";
import { noticeReferences, type ClaimedNotice, type SellerNotice } from "@core/src/features/orders/domain/seller-notice";

type PersistenceError = Readonly<{ code: string; message: string; retryable?: boolean }>;

export type NoticeLocale = "es" | "pt-BR";
export type NoticeProductNames = Readonly<{ name: string; attributeNames: readonly string[] }>;
/** Order numbers and product names of the ids a notice carries, read when the notice is described. */
export type NoticeNames = Readonly<{ orderNumbers: ReadonlyMap<OrderId, number>; products: ReadonlyMap<ProductId, NoticeProductNames> }>;
export type NoticeContext = Readonly<{ companyId: string; messageId: string; chatId: string; names: NoticeNames }>;
/** The data a notice push carries; the presentation layer validates it against the transport contract. */
export type RenderedNoticeData = Readonly<{ v: 1; companyId: string; messageId: string; target: "message" | "order" }>;
export type RenderedSellerNotice = Readonly<{ title: string; body: string; data: RenderedNoticeData; groupKey: string }>;

export type DescribeChatMessageNoticeDependencies = Readonly<{
  companyId: () => string;
  findOrderNumbers: (ids: readonly OrderId[]) => Promise<Result<ReadonlyMap<OrderId, number>, PersistenceError>>;
  findProductNames: (ids: readonly ProductId[]) => Promise<Result<ReadonlyMap<ProductId, NoticeProductNames>, PersistenceError>>;
  /** The texts of a notice in a language; supplied by the presentation layer through composition. */
  render: (notice: SellerNotice, locale: NoticeLocale, context: NoticeContext) => Result<RenderedSellerNotice, PersistenceError>;
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
  const rendered = deps.render(claim.notice, locale, {
    companyId: deps.companyId(), messageId: claim.messageId, chatId: claim.chatId, names: { orderNumbers: orderNumbers.data, products: products.data },
  });
  return rendered.success ? ok(rendered.data) : err(rendered.error);
}
