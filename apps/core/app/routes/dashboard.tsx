import { useState } from "react";
import { useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { Button } from "@/components/ui/button";
import { privateUserContext } from "@/private-user-context";
import { authClient } from "../../src/shared/infrastructure/auth-client";
import { z } from "zod";

const signOutResultSchema = z.object({ error: z.object({ message: z.string().optional() }).nullable() });

export function loader({ context }: LoaderFunctionArgs) {
  return { name: context.get(privateUserContext).user.name };
}

export default function Dashboard() {
  const { name } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      const result = signOutResultSchema.safeParse(await authClient.signOut());
      if (!result.success || result.data.error) throw new Error("Sign out failed");
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
