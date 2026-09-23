import { Outlet, redirect, type MiddlewareFunction } from "react-router";
import { privateUserContext } from "@/private-user-context";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { resolveCurrentUser } from "@core/src/shared/infrastructure/current-user";
import { companyRepository } from "@core/src/features/companies/infrastructure/company-repository";
import { isLocale } from "@/locale";

export const middleware: MiddlewareFunction<Response>[] = [async ({ request, context }, next) => {
  const path = new URL(request.url).pathname;
  const segment = path.split("/")[1];
  const locale = isLocale(segment) ? `/${segment}` : "";
  const user = await resolveCurrentUser(request.headers);
  if (!user) throw redirect(`${locale}/login`);
  if (!user.companyId) throw redirect(`${locale}/register`);
  const companyId = user.companyId;
  return withTenantIsolation(companyId, async () => {
    const country = await companyRepository.getCountry(companyId);
    const correctPath = `/es-${country}/dashboard`;
    if (path !== correctPath) throw redirect(correctPath);
    context.set(privateUserContext, user);
    return next();
  });
}];

export default function PrivateLayout() {
  return <Outlet />;
}
