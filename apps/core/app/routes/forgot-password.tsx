import { useTranslation } from "react-i18next";
import { localizedPath } from "@core/app/locale";
import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { AuthLayout, AuthLayoutDescription, AuthLayoutFooter, AuthLayoutHeader, AuthLayoutTitle } from "@core/app/components/ui/auth-layout";
import { TextLink } from "@core/app/components/ui/text-link";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";

export default function ForgotPassword() {
  const { t } = useTranslation();
  const location = useLocation();
  const path = (target: string) => localizedPath(location.pathname, target);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); setMessage("");
    try {
      const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}${path("/reset-password")}` });
      if (result.error) setError(t("auth.requestError"));
      else setMessage(t("auth.emailSent"));
    } catch { setError(t("auth.requestError")); }
    finally { setPending(false); }
  }
  return <AuthLayout>
    <AuthLayoutHeader><AuthLayoutTitle>{t("auth.forgotTitle")}</AuthLayoutTitle><AuthLayoutDescription>{t("auth.emailSent")}</AuthLayoutDescription></AuthLayoutHeader>
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field><FieldLabel htmlFor="email">{t("common.email")}</FieldLabel><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>
      {message && <Alert variant="success"><AlertDescription>{message}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button type="submit" disabled={pending}>{pending ? t("common.sending") : t("auth.sendLink")}</Button>
    </form>
    <AuthLayoutFooter><TextLink asChild><Link to={path("/login")}>{t("auth.backToLogin")}</Link></TextLink></AuthLayoutFooter>
  </AuthLayout>;
}
