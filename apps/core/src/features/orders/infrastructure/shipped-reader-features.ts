/**
 * The reader features that ship. Both ship: the tuning on dev kept them on (payment and closed-order dev cases all right, the 16-product floor holds; technical design, «Payment fallback»): the reader schema, the
 * context text and the eval scorer derive from this one value, and the pull request says which variant shipped.
 * - `paymentRequest`: the reader emits `payment_request`; off, payment requests map to `not_allowed` and the generic notice body.
 * - `closedOrderLine`: the context tells the reader when the chat's latest order is closed; off, a change to it gets the generic body.
 */
export const shippedReaderFeatures: Readonly<{ paymentRequest: boolean; closedOrderLine: boolean }> = { paymentRequest: true, closedOrderLine: true };
