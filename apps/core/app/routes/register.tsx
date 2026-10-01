import { AuthForm } from "@/components/auth-form";
import { redirect, useLoaderData } from "react-router";
import { resolveCurrentAccess } from "@core/src/shared/infrastructure/current-user";
import { localizedPath } from "@core/app/locale";

export async function loader({ request }: { request: Request }) {
  const result = await resolveCurrentAccess(request.headers);
  if (!result.success && result.error.code !== "UNAUTHENTICATED") {
    throw new Response("Service unavailable", { status: result.error.code === "PERSISTENCE_UNAVAILABLE" || result.error.code === "AUTH_SERVICE_UNAVAILABLE" ? 503 : 500 });
  }
  const path = (target: string) => localizedPath(new URL(request.url).pathname, target);
  if (result.success && result.data.status === "verification_required") throw redirect(path("/check-email"));
  if (result.success && result.data.status === "ready") throw redirect(path("/dashboard"));
  return { pendingCompany: result.success };
}

export default function Register() {
  const { pendingCompany } = useLoaderData<typeof loader>();
  return <AuthForm mode="register" pendingCompany={pendingCompany} />;
}
