import type { Result } from "@shared/result";
import type { CourierId } from "@core/src/features/delivery-settings/domain/delivery-settings";

export type CompanyCourierSummary = Readonly<{ id: CourierId; name: string; enabled: boolean }>;
export type ListCompanyCouriersError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** The store's couriers (disabled ones included: their orders still exist), for turning a courier name into the id orders carry. */
export function listCompanyCouriers(input: Readonly<{ companyId: string }>,
  readCouriers: (companyId: string) => Promise<Result<readonly CompanyCourierSummary[], ListCompanyCouriersError>>) {
  return readCouriers(input.companyId);
}
