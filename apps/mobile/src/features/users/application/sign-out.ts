import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { MobileAuth, StorageError } from "./contracts";

export type LogoutOutcome = Readonly<{ remoteRevocation: "confirmed" | "unconfirmed" }>;
export type SignOutDependencies = Readonly<{
  invalidatePendingOperations: () => void;
  revokeSession: MobileAuth["revokeSession"];
  clearLocalSession: MobileAuth["clearLocalSession"];
  clearPrivateState: () => void;
}>;

export async function signOut(dependencies: SignOutDependencies): Promise<Result<LogoutOutcome, StorageError>> {
  dependencies.invalidatePendingOperations();
  const revoked = await dependencies.revokeSession();
  dependencies.clearPrivateState();
  const cleared = await dependencies.clearLocalSession();
  if (!cleared.success) return err(cleared.error);
  return ok({ remoteRevocation: revoked.success ? "confirmed" : "unconfirmed" });
}
