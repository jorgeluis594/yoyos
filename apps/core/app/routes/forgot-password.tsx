import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); setMessage("");
    try {
      const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
      if (result.error) setError("No se pudo procesar la solicitud. Inténtalo de nuevo.");
      else setMessage("Si existe una cuenta con ese correo, recibirás un enlace.");
    } catch { setError("No se pudo procesar la solicitud. Inténtalo de nuevo."); }
    finally { setPending(false); }
  }
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4"><h1 className="text-2xl font-semibold">Recuperar contraseña</h1><p className="mt-3 text-muted-foreground">Si existe una cuenta con ese correo, recibirás un enlace.</p><form onSubmit={submit} className="mt-6 flex flex-col gap-4"><Field><FieldLabel htmlFor="email">Correo electrónico</FieldLabel><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}<Button type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviar enlace"}</Button></form><Link className="mt-5 underline" to="/login">Volver a iniciar sesión</Link></main>;
}
