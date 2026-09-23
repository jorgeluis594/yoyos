import { useState } from "react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { auth } from "../../src/infrastructure/auth";

export async function loader({ request }: { request: Request }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect("/login");
  return { name: session.user.name };
}

export default function Dashboard() {
  const { name } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      const result = await authClient.signOut();
      if (result.error) throw result.error;
      navigate("/login");
    } catch {
      setError("No se pudo cerrar la sesión. Inténtalo de nuevo.");
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <span className="text-xl font-semibold">Yoyos</span>
        <Button type="button" variant="outline" onClick={signOut} disabled={pending}>Cerrar sesión</Button>
      </header>
      <div>
        <h1 className="text-2xl font-semibold">Hola, {name}</h1>
        <p className="mt-2 text-muted-foreground">Tu espacio de trabajo está listo.</p>
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      </div>
    </main>
  );
}
