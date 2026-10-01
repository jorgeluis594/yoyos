import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";
import { localizedPath } from "@core/app/locale";
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
  const { t, i18n } = useTranslation();
  const regionNames = new Intl.DisplayNames([i18n.language], { type: "region" });
  const countryItems = [{ value: null, label: t("auth.selectCountry") }, ...countries.map((country) => ({ value: country, label: regionNames.of(country) ?? country }))];
  const isRegister = mode === "register" && !pendingCompany;
  const navigate = useNavigate();
  const location = useLocation();
  const path = (target: string) => localizedPath(location.pathname, target);
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
          setError(t("auth.invalidCompany"));
          return;
        }
        const created = await createCompanyForCurrentUser({ ...company.data, name: company.data.name.trim() });
        if (!created.success) { setError(t("auth.createCompanyError")); return; }
      } else if (isRegister) {
        const result = await registerWeb({
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          password: String(data.get("password") ?? ""),
        });
        if (!result.success) { setError(result.error.code === "INVALID_INPUT" ? t("auth.invalidAccount") : t("auth.registerError")); return; }
        navigate(path("/check-email"), { state: { email: String(data.get("email") ?? "") } });
        return;
      } else {
        const credentials = credentialsSchema.safeParse({ email: data.get("email"), password: data.get("password") });
        if (!credentials.success) { setError(t("auth.invalidCredentials")); return; }
        const result = authResultSchema.safeParse(await authClient.signIn.email(credentials.data));
        if (!result.success || !result.data.data && !result.data.error) { setError(t("auth.invalidResponse")); return; }
        if (result.data.error) { setError(t("auth.loginError")); return; }
      }
      navigate(path("/dashboard"));
    } catch {
      setError(t("auth.connectionError"));
    } finally { setPending(false); }
  }

  return <main className="flex min-h-screen items-center justify-center px-4 py-12"><div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 sm:p-8">
    <Link to={path("/")} className="text-sm font-semibold text-primary">Yoyos</Link>
    <h1 className="mt-6 text-2xl font-semibold">{pendingCompany ? t("auth.companyTitle") : isRegister ? t("auth.createAccount") : t("common.login")}</h1>
    <p className="mt-2 text-sm text-muted-foreground">{pendingCompany ? t("auth.companyDescription") : isRegister ? t("auth.registerDescription") : t("auth.loginDescription")}</p>
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      {isRegister && <Field><FieldLabel htmlFor="name">{t("common.name")}</FieldLabel><Input id="name" name="name" autoComplete="name" required /></Field>}
      {!pendingCompany && <>
        <Field><FieldLabel htmlFor="email">{t("common.email")}</FieldLabel><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field><FieldLabel htmlFor="password">{t("common.password")}</FieldLabel><Input id="password" name="password" type="password" autoComplete={isRegister ? "new-password" : "current-password"} minLength={isRegister ? 8 : undefined} maxLength={isRegister ? 128 : undefined} required /></Field>
      </>}
      {pendingCompany && <>
        <Field><FieldLabel htmlFor="companyName">{t("auth.companyName")}</FieldLabel><Input id="companyName" name="companyName" required maxLength={120} /></Field>
        <Field><FieldLabel htmlFor="country">{t("auth.country")}</FieldLabel><Select name="country" required items={countryItems} defaultValue={null}><SelectTrigger id="country"><SelectValue placeholder={t("auth.selectCountry")} /></SelectTrigger><SelectContent><SelectGroup>{countryItems.map((item) => <SelectItem key={item.value ?? "placeholder"} value={item.value} disabled={item.value === null}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? t("auth.wait") : pendingCompany ? t("auth.createCompany") : isRegister ? t("auth.createAccount") : t("auth.enter")}</Button>
    </form>
    {!pendingCompany && <p className="mt-6 text-center text-sm text-muted-foreground">{isRegister ? t("auth.hasAccount") : t("auth.noAccount")}<Link to={path(isRegister ? "/login" : "/register")} className="font-medium text-primary underline underline-offset-4">{isRegister ? t("common.login") : t("auth.register")}</Link></p>}
    {!pendingCompany && !isRegister && <Link to={path("/forgot-password")} className="mt-3 block text-center text-sm font-medium text-primary underline underline-offset-4">{t("auth.forgotLink")}</Link>}
  </div></main>;
}
