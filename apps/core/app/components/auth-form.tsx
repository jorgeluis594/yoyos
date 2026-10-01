import { useLocalization } from "@core/app/localization";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@core/app/components/ui/select";
import { countries } from "@shared/country";
import { createCompanyRequestSchema } from "@shared/contracts/registration";
import { z } from "zod";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
import { createCompanyForCurrentUser, registerWeb } from "@core/app/register";

const credentialsSchema = z.object({ email: z.email(), password: z.string().min(1) });
const authResultSchema = z.object({ error: z.object({ message: z.string().optional() }).nullable(), data: z.unknown().nullable() });

export function AuthForm({ mode, pendingCompany = false }: { mode: "login" | "register"; pendingCompany?: boolean }) {
  const { t, href } = useLocalization();
  const countryNames = { PE: "Perú", US: "Estados Unidos", CO: "Colombia", AR: "Argentina", CL: "Chile", BR: "Brasil" };
  const countryItems = [{ value: null, label: t("Selecciona un país") }, ...countries.map((country) => ({ value: country, label: t(countryNames[country]) }))];

  const isRegister = mode === "register" && !pendingCompany;
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const data = new FormData(event.currentTarget);
    try {
      if (pendingCompany) {
        const company = createCompanyRequestSchema.safeParse({ name: data.get("companyName"), country: data.get("country") });
        if (!company.success || !company.data.name.trim() || company.data.name.trim().length > 120) {
          setError(t("Revisa el nombre y el país de la empresa."));
          return;
        }
        const created = await createCompanyForCurrentUser({ ...company.data, name: company.data.name.trim() });
        if (!created.success) { setError(t("No se pudo crear la empresa. Inténtalo de nuevo.")); return; }
      } else if (isRegister) {
        const result = await registerWeb({
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          password: String(data.get("password") ?? ""),
        }, href("/account-verified"));
        if (!result.success) { setError(result.error.code === "INVALID_INPUT" ? t("Revisa los datos de la cuenta.") : t("No se pudo enviar la solicitud. Inténtalo de nuevo.")); return; }
        navigate(href("/check-email"), { state: { email: String(data.get("email") ?? "") } });
        return;
      } else {
        const credentials = credentialsSchema.safeParse({ email: data.get("email"), password: data.get("password") });
        if (!credentials.success) { setError(t("Revisa el correo y la contraseña.")); return; }
        const result = authResultSchema.safeParse(await authClient.signIn.email(credentials.data));
        if (!result.success || !result.data.data && !result.data.error) { setError(t("Respuesta de autenticación inválida.")); return; }
        if (result.data.error) { setError(t("No se pudo iniciar sesión.")); return; }
      }
      navigate(href("/dashboard"));
    } catch {
      setError(t("No se pudo conectar. Inténtalo de nuevo."));
    } finally { setPending(false); }
  }

  return <main className="flex min-h-screen items-center justify-center px-4 py-12"><div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 sm:p-8">
    <Link to={href("/")} className="text-sm font-semibold text-primary">Yoyos</Link>
    <h1 className="mt-6 text-2xl font-semibold">{pendingCompany ? t("Crea tu empresa") : isRegister ? t("Crear cuenta") : t("Iniciar sesión")}</h1>
    <p className="mt-2 text-sm text-muted-foreground">{pendingCompany ? t("Tu correo está verificado. Completa tu espacio de trabajo.") : isRegister ? t("Te enviaremos un enlace para verificar tu correo.") : t("Accede a tu espacio de trabajo.")}</p>
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      {isRegister && <Field><FieldLabel htmlFor="name">{t("Nombre")}</FieldLabel><Input id="name" name="name" autoComplete="name" required /></Field>}
      {!pendingCompany && <>
        <Field><FieldLabel htmlFor="email">{t("Correo electrónico")}</FieldLabel><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field><FieldLabel htmlFor="password">{t("Contraseña")}</FieldLabel><Input id="password" name="password" type="password" autoComplete={isRegister ? "new-password" : "current-password"} minLength={isRegister ? 8 : undefined} maxLength={isRegister ? 128 : undefined} required /></Field>
      </>}
      {pendingCompany && <>
        <Field><FieldLabel htmlFor="companyName">{t("Nombre de empresa")}</FieldLabel><Input id="companyName" name="companyName" required maxLength={120} /></Field>
        <Field><FieldLabel htmlFor="country">{t("País")}</FieldLabel><Select name="country" required items={countryItems} defaultValue={null}><SelectTrigger id="country"><SelectValue placeholder={t("Selecciona un país")} /></SelectTrigger><SelectContent><SelectGroup>{countryItems.map((item) => <SelectItem key={item.value ?? "placeholder"} value={item.value} disabled={item.value === null}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? t("Espera…") : pendingCompany ? t("Crear empresa") : isRegister ? t("Crear cuenta") : t("Entrar")}</Button>
    </form>
    {!pendingCompany && <p className="mt-6 text-center text-sm text-muted-foreground">{isRegister ? t("¿Ya tienes cuenta? ") : t("¿Aún no tienes cuenta? ")}<Link to={href(isRegister ? "/login" : "/register")} className="font-medium text-primary underline underline-offset-4">{isRegister ? t("Inicia sesión") : t("Regístrate")}</Link></p>}
    {!pendingCompany && !isRegister && <Link to={href("/forgot-password")} className="mt-3 block text-center text-sm font-medium text-primary underline underline-offset-4">{t("¿Olvidaste tu contraseña?")}</Link>}
  </div></main>;
}
