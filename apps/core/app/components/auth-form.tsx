import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { countries } from "@shared/country";
import { z } from "zod";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
import type { RegisterError } from "@core/src/features/users/application/register";
import { registerWeb } from "@/register";

const countryNames = { PE: "Perú", US: "Estados Unidos", CO: "Colombia", AR: "Argentina", CL: "Chile", BR: "Brasil" };
const countryItems = [
  { value: null, label: "Selecciona un país" },
  ...countries.map((country) => ({ value: country, label: countryNames[country] })),
];
const credentialsSchema = z.object({ email: z.email(), password: z.string().min(8) });
const authResultSchema = z.object({
  error: z.object({ message: z.string().optional() }).nullable(),
  data: z.object({ user: z.object({ id: z.string().min(1) }) }).nullable(),
});

function registrationMessage(error: RegisterError): string {
  if (error.code === "NETWORK_ERROR") return "No se pudo conectar. Inténtalo de nuevo.";
  if (error.step === "account") {
    if (error.code === "INVALID_INPUT") return "Revisa los datos de la cuenta.";
    if (error.code === "INVALID_RESPONSE") return "Respuesta de autenticación inválida.";
    return error.message;
  }
  if (error.code === "INVALID_INPUT") return "Revisa el nombre y el país de la empresa.";
  if (error.code === "REJECTED") return "No se pudo crear la empresa. Inténtalo de nuevo.";
  return error.code === "INVALID_RESPONSE"
    ? "Respuesta de empresa inválida."
    : "No se recibió una respuesta válida. Inténtalo de nuevo.";
}

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

    try {
      if (companyStep || register) {
        const company = { name: String(data.get("companyName") ?? ""), country: String(data.get("country") ?? "") };
        const result = await registerWeb({
          company,
          ...(!companyStep && { account: { name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") } }),
        });
        if (!result.success) {
          if (result.error.step === "company" && result.error.code !== "INVALID_INPUT") {
            setCompanyName(company.name);
            setCompanyCountry(company.country);
            setCompanyStep(true);
          }
          setError(registrationMessage(result.error));
          return;
        }
      } else {
        const credentials = credentialsSchema.safeParse({ email: data.get("email"), password: data.get("password") });
        if (!credentials.success) {
          setError("Revisa el correo y la contraseña.");
          return;
        }
        const result = authResultSchema.safeParse(await authClient.signIn.email(credentials.data));
        if (!result.success || !result.data.data && !result.data.error) {
          setError("Respuesta de autenticación inválida.");
          return;
        }
        if (result.data.error) {
          setError(result.data.error.message ?? "No se pudo iniciar sesión.");
          return;
        }
      }
      navigate("/dashboard");
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
        <h1 className="mt-6 text-2xl font-semibold">{companyStep ? "Crear empresa" : register ? "Crear cuenta" : "Iniciar sesión"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {companyStep ? "Completa tu espacio de trabajo." : register ? "Empieza a organizar tus ventas." : "Accede a tu espacio de trabajo."}
        </p>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          {register && !companyStep && (
            <Field>
              <FieldLabel htmlFor="name">Nombre</FieldLabel>
              <Input id="name" name="name" autoComplete="name" required />
            </Field>
          )}
          {!companyStep && <>
            <Field>
              <FieldLabel htmlFor="email">Correo electrónico</FieldLabel>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Contraseña</FieldLabel>
              <Input id="password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={8} required />
            </Field>
          </>}
          {register && (
            <Field>
              <FieldLabel htmlFor="companyName">Nombre de empresa</FieldLabel>
              <Input id="companyName" name="companyName" required maxLength={120} defaultValue={companyName} />
            </Field>
          )}
          {register && (
            <Field>
              <FieldLabel htmlFor="country">País</FieldLabel>
              <Select name="country" required items={countryItems} defaultValue={companyCountry || null}>
                <SelectTrigger id="country"><SelectValue placeholder="Selecciona un país" /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {countryItems.map((item) => <SelectItem key={item.value ?? "placeholder"} value={item.value} disabled={item.value === null}>{item.label}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? "Espera..." : companyStep ? "Crear empresa" : register ? "Crear cuenta" : "Entrar"}</Button>
        </form>
        {!companyStep && <p className="mt-6 text-center text-sm text-muted-foreground">
          {register ? "¿Ya tienes cuenta? " : "¿Aún no tienes cuenta? "}
          <Link to={register ? "/login" : "/register"} className="font-medium text-primary underline underline-offset-4">
            {register ? "Inicia sesión" : "Regístrate"}
          </Link>
        </p>}
      </div>
    </main>
  );
}
