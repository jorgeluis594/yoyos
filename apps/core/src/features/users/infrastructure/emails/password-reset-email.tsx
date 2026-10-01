import { EmailLayout } from "@core/src/shared/emails/components/email-layout";
import { useTranslation } from "react-i18next";

export function PasswordResetEmail({ url }: { url: string }) {
  const { t } = useTranslation();
  return <EmailLayout preview={t("emails.resetPreview")}><h1 style={{ fontSize: 24 }}>{t("emails.resetTitle")}</h1><p>{t("emails.resetBody")}</p><a href={url} style={{ backgroundColor: "#166534", borderRadius: 6, color: "#ffffff", display: "inline-block", padding: "12px 20px", textDecoration: "none" }}>{t("emails.resetAction")}</a><p>{t("emails.resetExpiry")}</p></EmailLayout>;
}
