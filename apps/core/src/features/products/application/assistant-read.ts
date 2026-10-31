import type { Result } from "@shared/result";
import type { ProductReadError } from "@core/src/features/products/application/repository";

/** What a read for the assistant can answer; the two timeouts are told apart so an operator can see which limit was hit. */
export type AssistantReadError = ProductReadError
  | Readonly<{ code: "STATEMENT_TIMEOUT"; message: string }>
  | Readonly<{ code: "TRANSACTION_TIMEOUT"; message: string }>;     // the Prisma timer or maxWait (P2028)

/** Runs the reads against one budgeted snapshot, or joins the one already open. */
export type AssistantSnapshot = <T, E>(read: () => Promise<Result<T, E>>) => Promise<Result<T, E | AssistantReadError>>;
