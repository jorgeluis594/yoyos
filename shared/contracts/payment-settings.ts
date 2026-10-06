import { z } from "zod";

const text = z.string().trim().min(1);
const imageId = z.uuid().nullable();
export const paymentSettingsSchema = z.strictObject({ settings: z.array(z.union([
  z.strictObject({ method: z.literal("digital_wallet"), provider: text, holder: text, imageId }),
  z.strictObject({ method: z.literal("bank_transfer"), bank: text, holder: text,
    accountNumber: text.nullable(), cci: text.nullable(), imageId }),
])).max(2) });
