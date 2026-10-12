import { useTranslation } from "react-i18next";
import { localizedPath } from "@core/app/locale";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { z } from "zod";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { AuthLayout, AuthLayoutDescription, AuthLayoutHeader, AuthLayoutTitle } from "@core/app/components/ui/auth-layout";
import { TextLink } from "@core/app/components/ui/text-link";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";

const passwordSchema = z.string().min(8).max(128);
const resetResponseSchema = z.object({ status: z.literal(true) });

export function headers() { return { "Cache-Control": "no-store" }; }
export function meta() { return [{ name: "referrer", content: "no-referrer" }]; }

export default function ResetPassword() {
  const { t } = useTranslation();
  const location = useLocation();
  const path = (target: string) => localizedPath(location.pathname, target);
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const invalidLink = params.has("error") || !token;
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) { setError(t("auth.invalidPassword")); return; }
    setPending(true);
    try {
      const result = await authClient.resetPassword({ token, newPassword: parsed.data });
      const response = resetResponseSchema.safeParse(result.data);
      if (result.error || !response.success) setError(t("auth.invalidResetRequest"));
      else { setPassword(""); setCompleted(true); }
    } catch { setError(t("auth.invalidResetRequest")); }
    finally { setPending(false); }
  }
  return <AuthLayout>
    <AuthLayoutHeader><AuthLayoutTitle>{t("auth.resetTitle")}</AuthLayoutTitle>{(invalidLink || completed) && <AuthLayoutDescription>{invalidLink ? t("auth.invalidResetLink") : t("auth.passwordChanged")}</AuthLayoutDescription>}</AuthLayoutHeader>
    {invalidLink ? <TextLink asChild><Link to={path("/forgot-password")}>{t("auth.requestAnotherLink")}</Link></TextLink>
      : completed ? <TextLink asChild><Link to={path("/login")}>{t("common.login")}</Link></TextLink>
      : <form onSubmit={submit} className="flex flex-col gap-4">
        <Field><FieldLabel htmlFor="password">{t("auth.newPassword")}</FieldLabel><Input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} required /></Field>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={pending}>{pending ? t("auth.saving") : t("auth.changePassword")}</Button>
      </form>}
  </AuthLayout>;
}
