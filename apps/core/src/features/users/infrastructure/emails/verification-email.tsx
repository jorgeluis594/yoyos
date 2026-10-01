import { translate } from "@core/app/translations";
import type { Language } from "@core/app/locale";
import { EmailLayout } from "@core/src/shared/emails/components/email-layout";

export function VerificationEmail({ url, language = "es" }: { url: string; language?: Language }) {
  const t = (message: string) => translate(language, message);
  return <EmailLayout language={language} preview={t("Verifica tu correo para continuar")}><h1 style={{ fontSize: 24 }}>{t("Verifica tu correo")}</h1><p>{t("Confirma tu dirección para empezar a usar Yoyos.")}</p><a href={url} style={{ backgroundColor: "#166534", borderRadius: 6, color: "#ffffff", display: "inline-block", padding: "12px 20px", textDecoration: "none" }}>{t("Verificar correo")}</a><p>{t("El enlace vence en 24 horas.")}</p></EmailLayout>;
}
