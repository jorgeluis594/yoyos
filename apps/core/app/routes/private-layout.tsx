import { Outlet, redirect, type MiddlewareFunction } from "react-router";
import { privateUserContext } from "@/private-user-context";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { resolveCurrentAccess } from "@core/src/shared/infrastructure/current-user";
import { requireCompany } from "@core/src/features/users";
import { isLocale } from "@/locale";

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
  if (!ready.success) throw redirect(`${locale}/register`);
  const access = ready.data;
  return withTenantIsolation(access.company.id, async () => {
    const correctPath = `/es-${access.company.country}/dashboard`;
    if (path !== correctPath) throw redirect(correctPath);
    context.set(privateUserContext, access);
    return next();
  });
}];

export default function PrivateLayout() {
  return <Outlet />;
}
