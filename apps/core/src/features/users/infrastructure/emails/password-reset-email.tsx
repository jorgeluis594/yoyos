import { EmailLayout } from "@core/src/shared/emails/components/email-layout";
import { EmailButton, EmailNote, EmailText, EmailTitle } from "@core/src/shared/emails/components/email-content";
import { useTranslation } from "react-i18next";

export function PasswordResetEmail({ url }: { url: string }) {
  const { t } = useTranslation();
  return <EmailLayout preview={t("emails.resetPreview")} category={t("emails.securityCategory")} fallbackUrl={url}>
    <EmailTitle>{t("emails.resetTitle")}</EmailTitle>
    <EmailText>{t("emails.resetBody")}</EmailText>
    <EmailButton href={url}>{t("emails.resetAction")}</EmailButton>
    <EmailNote>{t("emails.resetExpiry")}</EmailNote>
  </EmailLayout>;
}
