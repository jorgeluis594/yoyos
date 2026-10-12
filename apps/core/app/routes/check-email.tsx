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

export default function CheckEmail() {
  const { t } = useTranslation();
  const location = useLocation();
  const path = (target: string) => localizedPath(location.pathname, target);
  const initialEmail = typeof location.state === "object" && location.state && "email" in location.state && typeof location.state.email === "string" ? location.state.email : "";
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage(""); setError("");
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL: `${window.location.origin}${path("/account-verified")}` });
      if (result.error) setError(t("auth.requestError"));
      else setMessage(t("auth.verificationSent"));
    } catch { setError(t("auth.requestError")); }
    finally { setPending(false); }
  }
  return <AuthLayout>
    <AuthLayoutHeader><AuthLayoutTitle>{t("auth.checkEmailTitle")}</AuthLayoutTitle><AuthLayoutDescription>{t("auth.checkEmailDescription")}</AuthLayoutDescription></AuthLayoutHeader>
    <form onSubmit={resend} className="flex flex-col gap-4">
      <Field><FieldLabel htmlFor="email">{t("common.email")}</FieldLabel><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>
      {message && <Alert variant="success"><AlertDescription>{message}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button type="submit" disabled={pending}>{pending ? t("common.sending") : t("auth.resendVerification")}</Button>
    </form>
    <AuthLayoutFooter><TextLink asChild><Link to={path("/login")}>{t("common.login")}</Link></TextLink><TextLink asChild><Link to={path("/forgot-password")}>{t("common.forgotPassword")}</Link></TextLink></AuthLayoutFooter>
  </AuthLayout>;
}
