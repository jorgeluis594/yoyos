import { z } from "zod";

export const emailAddressSchema = z.email().transform((value) => value.trim().toLowerCase());
export const registerAccountRequestSchema = z.object({
  name: z.string().trim().min(1),
  email: emailAddressSchema,
  password: z.string().min(8).max(128),
}).readonly();
export const accountRequestSchema = z.object({ email: emailAddressSchema }).readonly();
export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
}).readonly();
export const accountRequestAcceptedSchema = z.object({ status: z.literal("accepted") }).readonly();
export const passwordResetCompletedSchema = z.object({ status: z.literal("password_reset") }).readonly();

export type RegisterAccountRequest = z.infer<typeof registerAccountRequestSchema>;
export type AccountRequest = z.infer<typeof accountRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type AccountRequestAccepted = z.infer<typeof accountRequestAcceptedSchema>;
export type PasswordResetCompleted = z.infer<typeof passwordResetCompletedSchema>;
