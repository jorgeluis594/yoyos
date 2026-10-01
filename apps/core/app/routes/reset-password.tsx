import { useLocalization } from "@core/app/localization";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
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
  const { t, href } = useLocalization();
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
    if (!parsed.success) { setError(t("La contraseña debe tener entre 8 y 128 caracteres.")); return; }
    setPending(true);
    try {
      const result = await authClient.resetPassword({ token, newPassword: parsed.data });
      const response = resetResponseSchema.safeParse(result.data);
      if (result.error || !response.success) setError(t("El enlace no es válido o ya venció. Solicita otro."));
      else { setPassword(""); setCompleted(true); }
    } catch { setError(t("El enlace no es válido o ya venció. Solicita otro.")); }
    finally { setPending(false); }
  }
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4"><h1 className="text-2xl font-semibold">{t("Restablecer contraseña")}</h1>{invalidLink ? <><p className="mt-3 text-muted-foreground">{t("El enlace no es válido o ya venció.")}</p><Link className="mt-6 underline" to={href("/forgot-password")}>{t("Solicitar otro enlace")}</Link></> : completed ? <><p className="mt-3 text-muted-foreground">{t("La contraseña se cambió. Inicia sesión para continuar.")}</p><Link className="mt-6 underline" to={href("/login")}>{t("Iniciar sesión")}</Link></> : <form onSubmit={submit} className="mt-6 flex flex-col gap-4"><Field><FieldLabel htmlFor="password">{t("Nueva contraseña")}</FieldLabel><Input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} required /></Field>{error && <p role="alert">{error}</p>}<Button type="submit" disabled={pending}>{pending ? t("Guardando…") : t("Cambiar contraseña")}</Button></form>}</main>;
}
