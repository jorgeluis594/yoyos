import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { authClient } from "../../src/shared/infrastructure/auth-client";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const register = mode === "register";
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email"));
    const password = String(data.get("password"));

    try {
      const result = register
        ? await authClient.signUp.email({ name: String(data.get("name")), email, password })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "No se pudo completar la solicitud.");
      } else {
        navigate("/dashboard");
      }
    } catch {
      setError("No se pudo conectar. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 sm:p-8">
        <Link to="/" className="text-sm font-semibold text-primary">Yoyos</Link>
        <h1 className="mt-6 text-2xl font-semibold">{register ? "Crear cuenta" : "Iniciar sesión"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {register ? "Empieza a organizar tus ventas." : "Accede a tu espacio de trabajo."}
        </p>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          {register && (
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Nombre
              <input name="name" autoComplete="name" required className="h-10 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Correo electrónico
            <input name="email" type="email" autoComplete="email" required className="h-10 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Contraseña
            <input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={8} required className="h-10 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? "Espera..." : register ? "Crear cuenta" : "Entrar"}</Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {register ? "¿Ya tienes cuenta? " : "¿Aún no tienes cuenta? "}
          <Link to={register ? "/login" : "/register"} className="font-medium text-primary underline underline-offset-4">
            {register ? "Inicia sesión" : "Regístrate"}
          </Link>
        </p>
      </div>
    </main>
  );
}
