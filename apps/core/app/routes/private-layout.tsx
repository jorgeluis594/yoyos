import { Outlet, redirect, type MiddlewareFunction } from "react-router";
import { privateUserContext } from "@/private-user-context";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { resolveCurrentUser } from "@core/src/shared/infrastructure/current-user";

export const middleware: MiddlewareFunction<Response>[] = [async ({ request, context }, next) => {
  const user = await resolveCurrentUser(request.headers);
  if (!user) throw redirect("/es-PE/login");
  if (!user.companyId) throw redirect("/es-PE/register");
  context.set(privateUserContext, user);
  return withTenantIsolation(user.companyId, () => next());
}];

export default function PrivateLayout() {
  return <Outlet />;
}
