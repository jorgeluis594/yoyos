import { z } from "zod";

export const dispatchSenderNameMaxLength = 120;
export const dispatchSenderPhoneMaxLength = 30;

// Empty text means "not configured", so it is stored as null.
const optionalText = (maxLength: number) => z.string().trim().max(maxLength).nullable().transform((value) => value || null);

export const saveDispatchSenderSchema = z.strictObject({
  name: optionalText(dispatchSenderNameMaxLength),
  phone: optionalText(dispatchSenderPhoneMaxLength),
});

export const dispatchSenderResponseSchema = z.strictObject({
  configured: z.strictObject({
    name: z.string().min(1).max(dispatchSenderNameMaxLength).nullable(),
    phone: z.string().min(1).max(dispatchSenderPhoneMaxLength).nullable(),
  }),
  effective: z.strictObject({
    name: z.string().min(1),
    phone: z.string().min(1).max(dispatchSenderPhoneMaxLength).nullable(),
  }),
});

export type SaveDispatchSenderBody = z.infer<typeof saveDispatchSenderSchema>;
export type DispatchSenderResponse = z.infer<typeof dispatchSenderResponseSchema>;
