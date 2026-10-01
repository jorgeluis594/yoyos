import { translate } from "@core/app/translations";
import type { Language } from "@core/app/locale";
import { EmailLayout } from "@core/src/shared/emails/components/email-layout";

export function PasswordResetEmail({ url, language = "es" }: { url: string; language?: Language }) {
  const t = (message: string) => translate(language, message);
  return <EmailLayout language={language} preview={t("Recupera el acceso a tu cuenta Yoyos")}><h1 style={{ fontSize: 24 }}>{t("Restablece tu contraseña")}</h1><p>{t("Usa este enlace para elegir una contraseña nueva.")}</p><a href={url} style={{ backgroundColor: "#166534", borderRadius: 6, color: "#ffffff", display: "inline-block", padding: "12px 20px", textDecoration: "none" }}>{t("Cambiar contraseña")}</a><p>{t("El enlace vence en 30 minutos.")}</p></EmailLayout>;
}
