import { useTranslation } from "react-i18next";
import { localizedPath } from "@core/app/locale";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { z } from "zod";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
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
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4"><h1 className="text-2xl font-semibold">{t("auth.resetTitle")}</h1>{invalidLink ? <><p className="mt-3 text-muted-foreground">{t("auth.invalidResetLink")}</p><Link className="mt-6 underline" to={path("/forgot-password")}>{t("auth.requestAnotherLink")}</Link></> : completed ? <><p className="mt-3 text-muted-foreground">{t("auth.passwordChanged")}</p><Link className="mt-6 underline" to={path("/login")}>{t("common.login")}</Link></> : <form onSubmit={submit} className="mt-6 flex flex-col gap-4"><Field><FieldLabel htmlFor="password">{t("auth.newPassword")}</FieldLabel><Input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} required /></Field>{error && <p role="alert">{error}</p>}<Button type="submit" disabled={pending}>{pending ? t("auth.saving") : t("auth.changePassword")}</Button></form>}</main>;
}
