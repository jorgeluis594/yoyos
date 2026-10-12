import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

type Brand<Name extends string> = string & { readonly __brand: Name };

export type NativeMessageId = Brand<"NativeMessageId">;
export type DeliveryId = Brand<"DeliveryId">;
export type WhatsAppAccountId = Brand<"WhatsAppAccountId">;
export type WhatsAppChatId = Brand<"WhatsAppChatId">;
export type ProtocolMessageId = Brand<"ProtocolMessageId">;
export type ImageDownloadReference = Brand<"ImageDownloadReference">;
export type CompanyId = Brand<"CompanyId">;
export type UserId = Brand<"UserId">;
export type LinkId = Brand<"LinkId">;
export type CoreMessageId = Brand<"CoreMessageId">;

export type IdError = Readonly<{ code: "INVALID_ID"; message: string; field: string }>;

const lidSchema = z.string().regex(/^[0-9]+@lid$/);
const nativeMessageIdSchema = z.string().regex(/^wa-message:v1:[A-Za-z0-9_-]+$/);
const deliveryIdSchema = z.string().regex(/^wa-delivery:v1:[0-9a-f]{32}$/);
const imageReferenceSchema = z.string().regex(/^wa-image:v1:.+$/);
const nonEmptySchema = z.string().min(1);

function parseBranded<T extends string>(schema: z.ZodType<string>, value: string, field: string): Result<T, IdError> {
  return schema.safeParse(value).success
    ? ok(value as T)
    : err({ code: "INVALID_ID", message: `Invalid ${field}`, field });
}

export const parseAccountId = (value: string, field = "accountId") => parseBranded<WhatsAppAccountId>(lidSchema, value, field);
export const parseChatId = (value: string, field = "chatId") => parseBranded<WhatsAppChatId>(lidSchema, value, field);
export const parseNativeMessageId = (value: string, field = "id") => parseBranded<NativeMessageId>(nativeMessageIdSchema, value, field);
export const parseDeliveryId = (value: string, field = "deliveryId") => parseBranded<DeliveryId>(deliveryIdSchema, value, field);
export const parseImageReference = (value: string, field = "reference") => parseBranded<ImageDownloadReference>(imageReferenceSchema, value, field);
export const parseProtocolMessageId = (value: string, field = "whatsappMessageId") => parseBranded<ProtocolMessageId>(nonEmptySchema, value, field);
export const parseCompanyId = (value: string, field = "companyId") => parseBranded<CompanyId>(nonEmptySchema, value, field);
export const parseUserId = (value: string, field = "userId") => parseBranded<UserId>(nonEmptySchema, value, field);
export const parseLinkId = (value: string, field = "linkId") => parseBranded<LinkId>(nonEmptySchema, value, field);
export const parseCoreMessageId = (value: string, field = "messageId") => parseBranded<CoreMessageId>(nonEmptySchema, value, field);
