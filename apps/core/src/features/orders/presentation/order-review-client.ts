import { err, ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import { orderAggregateSchema, type OrderAggregateResponse } from "@shared/contracts/orders";
import { confirmOrderReviewResponseSchema, orderReviewErrorSchema, orderReviewResponseSchema, undoRefusalSchema, type ConfirmOrderReviewRequest, type ConfirmOrderReviewResponse, type OrderReviewError, type OrderReviewResponse } from "@shared/contracts/order-review";
import { undoMessageResponseSchema, undoMessageErrorSchema } from "@shared/contracts/order-message-undo";
import type { z } from "zod";

/** `no_answer` is a request that may or may not have been applied (network, timeout, unreadable answer): the caller repeats it with the same id. */
export type ReviewApiError = Readonly<{ code: "not_found" | "unavailable" | "no_answer"; message: string }>;
export type LoadedReview = Readonly<{ review: OrderReviewResponse; order: OrderAggregateResponse }>;
export type UndoRefusal = z.infer<typeof undoRefusalSchema>;
export type UndoApiError = ReviewApiError | Readonly<{ code: "refused"; message: string; reason: UndoRefusal; variantId: string | null }>;
export type ConfirmApiError = ReviewApiError | Readonly<{ code: "refused"; message: string; error: OrderReviewError }>;

/** The web seller's calls to the review API. The dialog takes it as a prop so its tests run on fakes. */
export type OrderReviewApi = Readonly<{
  /** The review with all its message rows and the order, read in parallel. */
  load: (orderId: string) => Promise<Result<LoadedReview, ReviewApiError>>;
  confirm: (orderId: string, request: ConfirmOrderReviewRequest) => Promise<Result<ConfirmOrderReviewResponse, ConfirmApiError>>;
  undo: (orderId: string, messageId: string) => Promise<Result<Readonly<{ order: OrderAggregateResponse; review: OrderReviewResponse }>, UndoApiError>>;
  /** Best effort: retried once, then dropped. */
  recordLinkAction: (orderId: string, input: Readonly<{ id: string; action: "copy" | "open" }>) => Promise<void>;
}>;

const timeoutMs = 15000;
const path = (orderId: string, suffix: string) => `/api/orders/${encodeURIComponent(orderId)}${suffix}`;

async function send(url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(url, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
      ...init, headers: init.body ? { "content-type": "application/json" } : undefined });
  } catch { return null; }
}

async function json(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return undefined; }
}

const failure = (response: Response | null): ReviewApiError => response === null ? { code: "no_answer", message: "No answer" } : response.status === 404 ? { code: "not_found", message: "Not found" } : { code: "unavailable", message: "Unavailable" };

async function load(orderId: string): Promise<Result<LoadedReview, ReviewApiError>> {
  const [review, order] = await Promise.all([send(path(orderId, "/review?rows=all")), send(path(orderId, "/aggregate"))]);
  if (!review?.ok || !order?.ok) return err(failure(!review?.ok ? review : order));
  const [reviewBody, orderBody] = [orderReviewResponseSchema.safeParse(await json(review)), orderAggregateSchema.safeParse(await json(order))];
  return reviewBody.success && orderBody.success ? ok({ review: reviewBody.data, order: orderBody.data }) : err({ code: "unavailable", message: "Unreadable answer" });
}

async function confirm(orderId: string, request: ConfirmOrderReviewRequest): Promise<Result<ConfirmOrderReviewResponse, ConfirmApiError>> {
  const response = await send(path(orderId, "/reviews"), { method: "POST", body: JSON.stringify(request) });
  if (!response) return err({ code: "no_answer", message: "No answer" });
  const body = await json(response);
  if (response.ok) {
    const parsed = confirmOrderReviewResponseSchema.safeParse(body);
    return parsed.success ? ok(parsed.data) : err({ code: "no_answer", message: "No answer" });
  }
  if (response.status === 400 || response.status === 409 || response.status === 422) {
    const refused = orderReviewErrorSchema.safeParse(body);
    if (refused.success) return err({ code: "refused", message: refused.data.error, error: refused.data });
  }
  return err(failure(response));
}

async function undo(orderId: string, messageId: string) {
  const response = await send(path(orderId, `/messages/${encodeURIComponent(messageId)}/undo`), { method: "POST" });
  if (!response) return err<UndoApiError>({ code: "no_answer", message: "No answer" });
  const body = await json(response);
  if (response.ok) {
    const parsed = undoMessageResponseSchema.safeParse(body);
    return parsed.success ? ok(parsed.data) : err<UndoApiError>({ code: "no_answer", message: "No answer" });
  }
  const refused = response.status === 409 ? undoMessageErrorSchema.safeParse(body) : null;
  if (refused?.success) return err<UndoApiError>({ code: "refused", message: refused.data.error, reason: refused.data.reason, variantId: refused.data.variantId ?? null });
  return err<UndoApiError>(failure(response));
}

async function recordLinkAction(orderId: string, input: Readonly<{ id: string; action: "copy" | "open" }>): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await send(path(orderId, "/link-actions"), { method: "POST", body: JSON.stringify({ version: 1, ...input }) });
    if (response && (response.ok || response.status < 500)) return;
  }
}

export const webOrderReviewApi: OrderReviewApi = { load, confirm, undo, recordLinkAction };

export const defaultRetryDelaysMs: readonly number[] = [1500, 3000];

/**
 * Repeats a request that got no answer, with the same ids, until it gets one: a repeat never applies a change twice.
 * `onNoAnswer` runs before each wait so the screen can say it is verifying.
 */
export async function untilAnswered<T, E extends AppError>(attempt: () => Promise<Result<T, E>>, delays: readonly number[], onNoAnswer: () => void = () => {}): Promise<Result<T, E>> {
  let result = await attempt();
  for (const delay of delays) {
    if (result.success || result.error.code !== "no_answer") return result;
    onNoAnswer();
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await attempt();
  }
  return result;
}
