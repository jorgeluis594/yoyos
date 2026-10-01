import { EmailLayout } from "@core/src/shared/emails/components/email-layout";
import { useTranslation } from "react-i18next";

export function VerificationEmail({ url }: { url: string }) {
  const { t } = useTranslation();
  return <EmailLayout preview={t("emails.verificationPreview")}><h1 style={{ fontSize: 24 }}>{t("emails.verificationTitle")}</h1><p>{t("emails.verificationBody")}</p><a href={url} style={{ backgroundColor: "#166534", borderRadius: 6, color: "#ffffff", display: "inline-block", padding: "12px 20px", textDecoration: "none" }}>{t("emails.verificationAction")}</a><p>{t("emails.verificationExpiry")}</p></EmailLayout>;
}
