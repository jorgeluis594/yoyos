import { z } from "zod";
import type { PositiveInteger } from "@core/src/features/orders/domain/order";
import type { ChatMessageLimits } from "@core/src/features/orders/application/apply-chat-message";

type Env = Readonly<Record<string, string | undefined>>;

const dayMs = 24 * 60 * 60 * 1000;

// Invalid values fail at startup; empty values count as unset.
const limitsSchema = z.object({
  CHAT_PENDING_TTL_DAYS: z.coerce.number().positive().default(7),
  READER_MAX_PRODUCTS: z.coerce.number().int().min(1).default(24),
  READER_MAX_ITEMS: z.coerce.number().int().min(1).default(40),
  READER_MAX_TEXT_CHARS: z.coerce.number().int().min(1).default(2000),
});

/** The limits of `applyChatMessage` from env: the item quantity is a business rule and stays 99. */
export function readChatMessageLimits(env: Env): ChatMessageLimits {
  const config = limitsSchema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  return { maxItemQuantity: 99 as PositiveInteger, pendingTtlMs: config.CHAT_PENDING_TTL_DAYS * dayMs, maxReaderProducts: config.READER_MAX_PRODUCTS,
    maxReaderItems: config.READER_MAX_ITEMS, maxReaderTextChars: config.READER_MAX_TEXT_CHARS };
}
