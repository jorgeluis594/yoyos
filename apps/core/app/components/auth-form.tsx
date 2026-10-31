import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";
import { localizedPath } from "@core/app/locale";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { AuthLayout, AuthLayoutDescription, AuthLayoutFooter, AuthLayoutHeader, AuthLayoutTitle } from "@core/app/components/ui/auth-layout";
import { TextLink } from "@core/app/components/ui/text-link";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { PasswordInput } from "@core/app/components/ui/password-input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@core/app/components/ui/select";
import { countries } from "@shared/country";
import { createCompanyRequestSchema } from "@shared/contracts/registration";
import { z } from "zod";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
import { createCompanyForCurrentUser, registerWeb } from "@core/app/register";
import { BrandLogo } from "@core/app/components/brand-logo";
import { hasSignedAuthorizationQuery } from "@core/app/lib/assistant-display";
import { isWebUrl, redirectBrowser } from "@core/app/lib/redirect-browser";

const credentialsSchema = z.object({ email: z.email(), password: z.string().min(1) });
const authResultSchema = z.object({ error: z.looseObject({ code: z.string().optional(), status: z.number().optional(), message: z.string().optional() }).nullable(), data: z.unknown().nullable() });
// Signing in from an agent request: Better Auth continues the authorization and answers where to go next.
const continuationSchema = z.object({ redirect: z.literal(true), url: z.string().min(1) });

export function AuthForm({ mode, pendingCompany = false }: { mode: "login" | "register"; pendingCompany?: boolean }) {
  const { t, i18n } = useTranslation();
  const regionNames = new Intl.DisplayNames([i18n.language], { type: "region" });
  const countryItems = [{ value: null, label: t("auth.selectCountry") }, ...countries.map((country) => ({ value: country, label: regionNames.of(country) ?? country }))];
  const isRegister = mode === "register" && !pendingCompany;
  const navigate = useNavigate();
  const location = useLocation();
  const path = (target: string) => localizedPath(location.pathname, target);
  const [error, setError] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const agentRequest = mode === "login" && !pendingCompany && hasSignedAuthorizationQuery(location.search);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setUnverifiedEmail(null);
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
        if (result.data.error) {
          const { code, status } = result.data.error;
          if (agentRequest && code === "EMAIL_NOT_VERIFIED") { setUnverifiedEmail(credentials.data.email); return; }
          // The continuation failed closed after the session was set: signing in again continues the request.
          if (agentRequest && status !== undefined && status >= 500) { setError(t("assistants.continueError")); return; }
          setError(t("auth.loginError"));
          return;
        }
        const continuation = continuationSchema.safeParse(result.data.data);
        if (agentRequest && continuation.success && isWebUrl(continuation.data.url)) { redirectBrowser(continuation.data.url); return; }
      }
      navigate(path("/dashboard"));
    } catch {
      setError(t("auth.connectionError"));
    } finally { setPending(false); }
  }

  return <AuthLayout>
    <AuthLayoutHeader>
      <Link to={path("/login")} className="self-start focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"><BrandLogo /></Link>
      <AuthLayoutTitle>{pendingCompany ? t("auth.companyTitle") : isRegister ? t("auth.createAccount") : t("common.login")}</AuthLayoutTitle>
      <AuthLayoutDescription>{pendingCompany ? t("auth.companyDescription") : isRegister ? t("auth.registerDescription") : t("auth.loginDescription")}</AuthLayoutDescription>
      {agentRequest && <p className="text-sm font-medium">{t("assistants.loginHint")}</p>}
    </AuthLayoutHeader>
    <form onSubmit={submit} className="flex flex-col gap-4">
      {isRegister && <Field><FieldLabel htmlFor="name">{t("common.name")}</FieldLabel><Input id="name" name="name" autoComplete="name" required /></Field>}
      {!pendingCompany && <>
        <Field><FieldLabel htmlFor="email">{t("common.email")}</FieldLabel><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field><FieldLabel htmlFor="password">{t("common.password")}</FieldLabel><PasswordInput id="password" name="password" autoComplete={isRegister ? "new-password" : "current-password"} minLength={isRegister ? 8 : undefined} maxLength={isRegister ? 128 : undefined} required /></Field>
      </>}
      {pendingCompany && <>
        <Field><FieldLabel htmlFor="companyName">{t("auth.companyName")}</FieldLabel><Input id="companyName" name="companyName" required maxLength={120} /></Field>
        <Field><FieldLabel htmlFor="country">{t("auth.country")}</FieldLabel><Select name="country" required items={countryItems} defaultValue={null}><SelectTrigger id="country"><SelectValue placeholder={t("auth.selectCountry")} /></SelectTrigger><SelectContent><SelectGroup>{countryItems.map((item) => <SelectItem key={item.value ?? "placeholder"} value={item.value} disabled={item.value === null}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      </>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {unverifiedEmail !== null && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-col gap-3">
        <span>{t("assistants.unverified")}</span>
        <Button asChild variant="outline" className="min-h-touch self-start"><Link to={path("/check-email")} state={{ email: unverifiedEmail }}>{t("assistants.resendVerification")}</Link></Button>
      </AlertDescription></Alert>}
      <Button type="submit" disabled={pending}>{pending ? t("auth.wait") : pendingCompany ? t("auth.createCompany") : isRegister ? t("auth.createAccount") : t("auth.enter")}</Button>
    </form>
    {!pendingCompany && <AuthLayoutFooter>
      <p>{isRegister ? t("auth.hasAccount") : t("auth.noAccount")}<TextLink asChild><Link to={path(isRegister ? "/login" : "/register")}>{isRegister ? t("auth.loginLink") : t("auth.register")}</Link></TextLink></p>
      {!isRegister && <TextLink asChild><Link to={path("/forgot-password")}>{t("auth.forgotLink")}</Link></TextLink>}
    </AuthLayoutFooter>}
  </AuthLayout>;
}
