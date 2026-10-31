import { z } from "zod";

/** Opaque digest of one editable part of an order, as `orderRevisions` computes it. */
export const orderRevisionSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const orderRevisionsSchema = z.strictObject({ items: orderRevisionSchema, customer: orderRevisionSchema, delivery: orderRevisionSchema });
