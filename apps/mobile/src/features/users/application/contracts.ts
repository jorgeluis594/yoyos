import type { Result } from "@shared/result";
import type { TransportError } from "@/shared/application/transport-error";
import type { UserAccess } from "./user-access";

export type AccessError = TransportError;
export type StorageError = Readonly<{ code: "SECURE_STORAGE_ERROR"; message: string }>;
export type AccountError = AccessError | Readonly<{
  code: "INVALID_INPUT" | "INVALID_CREDENTIALS";
  message: string;
}>;
export type SignInInput = Readonly<{ email: string; password: string }>;
export type MobileAuth = Readonly<{
  signIn: (input: SignInInput) => Promise<Result<void, AccountError>>;
  restoreSession: () => Promise<Result<"active" | "absent", AccessError>>;
  revokeSession: () => Promise<Result<void, AccessError>>;
  clearLocalSession: () => Promise<Result<void, StorageError>>;
}>;
export type AccessReader = () => Promise<Result<UserAccess, AccessError>>;
