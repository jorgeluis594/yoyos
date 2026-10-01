import { useLocalization } from "@core/app/localization";
import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";

export default function CheckEmail() {
  const { t, href } = useLocalization();
  const location = useLocation();
  const initialEmail = typeof location.state === "object" && location.state && "email" in location.state && typeof location.state.email === "string" ? location.state.email : "";
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage(""); setError("");
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL: `${window.location.origin}${href("/account-verified")}` });
      if (result.error) setError(t("No se pudo procesar la solicitud. Inténtalo de nuevo."));
      else setMessage(t("Si tienes una verificación pendiente, recibirás un enlace."));
    } catch { setError(t("No se pudo procesar la solicitud. Inténtalo de nuevo.")); }
    finally { setPending(false); }
  }
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4"><h1 className="text-2xl font-semibold">{t("Revisa tu correo")}</h1><p className="mt-3 text-muted-foreground">{t("Revisa tu correo si tienes una verificación pendiente. Si ya tienes cuenta, inicia sesión o recupera tu contraseña.")}</p><form onSubmit={resend} className="mt-6 flex flex-col gap-4"><Field><FieldLabel htmlFor="email">{t("Correo electrónico")}</FieldLabel><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}<Button type="submit" disabled={pending}>{pending ? t("Enviando…") : t("Reenviar verificación")}</Button></form><div className="mt-5 flex gap-4 text-sm"><Link to={href("/login")} className="underline">{t("Iniciar sesión")}</Link><Link to={href("/forgot-password")} className="underline">{t("Recuperar contraseña")}</Link></div></main>;
}
