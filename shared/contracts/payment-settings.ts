import { z } from "zod";

const text = z.string().trim().min(1);
const imageId = z.uuid();
const bank = { method: z.literal("bank_transfer"), bank: text, holder: text, accountNumber: text.nullable(), cci: text.nullable(), imageId: imageId.nullable() };

// A client sends the wallet image and never the qr status: the server decides it.
export const paymentSettingsInputSchema = z.strictObject({ settings: z.array(z.union([
  z.strictObject({ method: z.literal("digital_wallet"), provider: text, holder: text, imageId }),
  z.strictObject(bank),
])).max(2) });

export const paymentSettingsResponseSchema = z.strictObject({ settings: z.array(z.union([
  z.strictObject({ method: z.literal("digital_wallet"), provider: text, holder: text,
    qr: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("verified"), imageId }),
      z.strictObject({ status: z.literal("unchecked"), imageId: imageId.nullable() }),
    ]) }),
  z.strictObject(bank),
])).max(2) });

export const paymentQrCheckSchema = z.strictObject({ imageId });
export const paymentQrCheckResponseSchema = z.strictObject({ status: z.enum(["verified", "not_a_qr"]) });

export type PaymentSettingsResponse = z.infer<typeof paymentSettingsResponseSchema>;
