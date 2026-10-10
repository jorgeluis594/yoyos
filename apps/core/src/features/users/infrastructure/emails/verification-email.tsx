import { EmailLayout } from "@core/src/shared/emails/components/email-layout";
import { EmailButton, EmailDetails, EmailText, EmailTitle } from "@core/src/shared/emails/components/email-content";
import { useTranslation } from "react-i18next";

export function VerificationEmail({ to, url }: { to: string; url: string }) {
  const { t } = useTranslation();
  return <EmailLayout preview={t("emails.verificationPreview")} category={t("emails.accountCategory")} fallbackUrl={url}>
    <EmailTitle>{t("emails.verificationTitle")}</EmailTitle>
    <EmailText>{t("emails.verificationBody")}</EmailText>
    <EmailDetails rows={[
      { label: t("emails.verificationEmailLabel"), value: to },
      { label: t("emails.verificationExpiryLabel"), value: t("emails.verificationExpiryValue") },
    ]} />
    <EmailButton href={url}>{t("emails.verificationAction")}</EmailButton>
  </EmailLayout>;
}
