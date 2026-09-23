import { AuthForm } from "@/components/auth-form";
import { redirect, useLoaderData } from "react-router";
import { resolveCurrentUser } from "@core/src/shared/infrastructure/current-user";

export async function loader({ request }: { request: Request }) {
  const user = await resolveCurrentUser(request.headers);
  if (user?.companyId) throw redirect("/dashboard");
  return { pendingCompany: Boolean(user) };
}

export default function Register() {
  const { pendingCompany } = useLoaderData<typeof loader>();
  return <AuthForm mode="register" pendingCompany={pendingCompany} />;
}
