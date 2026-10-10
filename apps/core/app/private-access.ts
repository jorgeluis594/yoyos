import { redirect, type MiddlewareFunction } from "react-router";
import { privateUserContext } from "@core/app/private-user-context";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { bindCompanyToRequest } from "@core/src/shared/infrastructure/logger";
import { resolveCurrentAccess } from "@core/src/shared/infrastructure/current-user";
import { requireCompany } from "@core/src/features/users";
import { companyPath, isLocale } from "@core/app/locale";

export const middleware: MiddlewareFunction<Response>[] = [async ({ request, context }, next) => {
  const path = new URL(request.url).pathname;
  const segment = path.split("/")[1];
  const locale = isLocale(segment) ? `/${segment}` : "";
  const result = await resolveCurrentAccess(request.headers);
  if (!result.success) {
    if (result.error.code === "UNAUTHENTICATED") throw redirect(`${locale}/login`);
    throw new Response("Service unavailable", { status: result.error.code === "PERSISTENCE_UNAVAILABLE" || result.error.code === "AUTH_SERVICE_UNAVAILABLE" ? 503 : 500 });
  }
  const ready = requireCompany(result.data);
  if (!ready.success) throw redirect(`${locale}${ready.error.code === "EMAIL_VERIFICATION_REQUIRED" ? "/check-email" : "/register"}`);
  const access = ready.data;
  bindCompanyToRequest(access.company.id);
  return withTenantIsolation(access.company.id, async () => {
    const requestedPath = isLocale(segment) ? path.slice(segment.length + 1) : path;
    const correctPath = companyPath(path, access.company.country, requestedPath);
    if (path !== correctPath) throw redirect(`${correctPath}${new URL(request.url).search}`);
    context.set(privateUserContext, access);
    return next();
  });
}];
