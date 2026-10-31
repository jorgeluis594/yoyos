import type { UserId } from "@shared/identity";
import { loadUserAccess } from "@core/src/features/users";
import { userRepository } from "@core/src/features/users/infrastructure/user-repository";
import { companyRepository } from "@core/src/features/companies/infrastructure/company-repository";

/** Account access for the assistants feature, wired from the users and companies adapters. It must not import `auth.ts`: the auth hooks use it. */
export const loadAccountAccess = (userId: UserId) =>
  loadUserAccess(userId, { ...userRepository, findCompany: companyRepository.findCompany });
