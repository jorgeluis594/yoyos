import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { countries } from "@shared/country";
import { authClient } from "../../src/shared/infrastructure/auth-client";

const countryNames = { PE: "Perú", US: "Estados Unidos", CO: "Colombia", AR: "Argentina", CL: "Chile", BR: "Brasil" };

export function AuthForm({ mode, pendingCompany = false }: { mode: "login" | "register"; pendingCompany?: boolean }) {
  const register = mode === "register";
  const navigate = useNavigate();
  const [companyStep, setCompanyStep] = useState(pendingCompany);
  const [companyName, setCompanyName] = useState("");
  const [companyCountry, setCompanyCountry] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const data = new FormData(event.currentTarget);
    if (register) {
      setCompanyName(String(data.get("companyName")));
      setCompanyCountry(String(data.get("country")));
    }

    try {
      if (companyStep || register) {
        if (!companyStep) {
          const result = await authClient.signUp.email({
            name: String(data.get("name")),
            email: String(data.get("email")),
            password: String(data.get("password")),
          });
          if (result.error) {
            setError(result.error.message ?? "No se pudo crear la cuenta.");
            return;
          }
          setCompanyStep(true);
        }
        const response = await fetch("/api/company", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: String(data.get("companyName")), country: String(data.get("country")) }),
        });
        if (!response.ok) {
          setError("No se pudo crear la empresa. Inténtalo de nuevo.");
          return;
        }
      } else {
        const result = await authClient.signIn.email({
          email: String(data.get("email")),
          password: String(data.get("password")),
        });
        if (result.error) {
          setError(result.error.message ?? "No se pudo iniciar sesión.");
          return;
        }
      }
      navigate("/es-PE/dashboard");
    } catch {
      setError("No se pudo conectar. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 sm:p-8">
        <Link to="/es-PE/" className="text-sm font-semibold text-primary">Yoyos</Link>
        <h1 className="mt-6 text-2xl font-semibold">{companyStep ? "Crear empresa" : register ? "Crear cuenta" : "Iniciar sesión"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {companyStep ? "Completa tu espacio de trabajo." : register ? "Empieza a organizar tus ventas." : "Accede a tu espacio de trabajo."}
        </p>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          {register && !companyStep && (
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Nombre
              <input name="name" autoComplete="name" required className="h-10 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
          )}
          {!companyStep && <>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Correo electrónico
              <input name="email" type="email" autoComplete="email" required className="h-10 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Contraseña
              <input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={8} required className="h-10 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
          </>}
          {register && <label className="flex flex-col gap-1.5 text-sm font-medium">
            Nombre de empresa
            <input name="companyName" required maxLength={120} defaultValue={companyName} className="h-10 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>}
          {register && <label className="flex flex-col gap-1.5 text-sm font-medium">
            País
            <select name="country" required defaultValue={companyCountry} className="h-10 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="" disabled>Selecciona un país</option>
              {countries.map((country) => <option key={country} value={country}>{countryNames[country]}</option>)}
            </select>
          </label>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? "Espera..." : companyStep ? "Crear empresa" : register ? "Crear cuenta" : "Entrar"}</Button>
        </form>
        {!companyStep && <p className="mt-6 text-center text-sm text-muted-foreground">
          {register ? "¿Ya tienes cuenta? " : "¿Aún no tienes cuenta? "}
          <Link to={register ? "/es-PE/login" : "/es-PE/register"} className="font-medium text-primary underline underline-offset-4">
            {register ? "Inicia sesión" : "Regístrate"}
          </Link>
        </p>}
      </div>
    </main>
  );
}
