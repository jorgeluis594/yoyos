import { EmailLayout } from "@core/src/shared/emails/components/email-layout";

export function PasswordResetEmail({ url }: { url: string }) {
  return <EmailLayout preview="Recupera el acceso a tu cuenta Yoyos"><h1 style={{ fontSize: 24 }}>Restablece tu contraseña</h1><p>Usa este enlace para elegir una contraseña nueva.</p><a href={url} style={{ backgroundColor: "#166534", borderRadius: 6, color: "#ffffff", display: "inline-block", padding: "12px 20px", textDecoration: "none" }}>Cambiar contraseña</a><p>El enlace vence en 30 minutos.</p></EmailLayout>;
}
