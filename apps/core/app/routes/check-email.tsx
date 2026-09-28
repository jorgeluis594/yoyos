import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";

export default function CheckEmail() {
  const location = useLocation();
  const initialEmail = typeof location.state === "object" && location.state && "email" in location.state && typeof location.state.email === "string" ? location.state.email : "";
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage(""); setError("");
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL: `${window.location.origin}/account-verified` });
      if (result.error) setError("No se pudo procesar la solicitud. Inténtalo de nuevo.");
      else setMessage("Si tienes una verificación pendiente, recibirás un enlace.");
    } catch { setError("No se pudo procesar la solicitud. Inténtalo de nuevo."); }
    finally { setPending(false); }
  }
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4"><h1 className="text-2xl font-semibold">Revisa tu correo</h1><p className="mt-3 text-muted-foreground">Revisa tu correo si tienes una verificación pendiente. Si ya tienes cuenta, inicia sesión o recupera tu contraseña.</p><form onSubmit={resend} className="mt-6 flex flex-col gap-4"><Field><FieldLabel htmlFor="email">Correo electrónico</FieldLabel><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}<Button type="submit" disabled={pending}>{pending ? "Enviando…" : "Reenviar verificación"}</Button></form><div className="mt-5 flex gap-4 text-sm"><Link to="/login" className="underline">Iniciar sesión</Link><Link to="/forgot-password" className="underline">Recuperar contraseña</Link></div></main>;
}
