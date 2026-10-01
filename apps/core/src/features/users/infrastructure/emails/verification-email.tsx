import { EmailLayout } from "@core/src/shared/emails/components/email-layout";

export function VerificationEmail({ url }: { url: string }) {
  return <EmailLayout preview="Verifica tu correo para continuar"><h1 style={{ fontSize: 24 }}>Verifica tu correo</h1><p>Confirma tu dirección para empezar a usar Yoyos.</p><a href={url} style={{ backgroundColor: "#166534", borderRadius: 6, color: "#ffffff", display: "inline-block", padding: "12px 20px", textDecoration: "none" }}>Verificar correo</a><p>El enlace vence en 24 horas.</p></EmailLayout>;
}
