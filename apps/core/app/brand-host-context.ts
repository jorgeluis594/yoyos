import { createContext } from "react-router";
import type { CompanyId } from "@shared/identity";

/** The company that owns the brand host serving the request, set for checkout paths only; null on the app host. */
export const brandHostCompanyContext = createContext<CompanyId | null>(null);
