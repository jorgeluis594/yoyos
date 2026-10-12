import { useTranslation } from "react-i18next";
import { localizedPath } from "@core/app/locale";
import { AuthLayout, AuthLayoutDescription, AuthLayoutHeader, AuthLayoutTitle } from "@core/app/components/ui/auth-layout";
import { TextLink } from "@core/app/components/ui/text-link";
import { Link, useLocation, useSearchParams } from "react-router";

export default function AccountVerified() {
  const { t } = useTranslation();
  const location = useLocation();
  const path = (target: string) => localizedPath(location.pathname, target);
  const [params] = useSearchParams();
  const failed = params.has("error");
  return <AuthLayout>
    <AuthLayoutHeader><AuthLayoutTitle>{failed ? t("auth.verificationFailedTitle") : t("auth.verifiedTitle")}</AuthLayoutTitle><AuthLayoutDescription>{failed ? t("auth.verificationFailedDescription") : t("auth.verifiedDescription")}</AuthLayoutDescription></AuthLayoutHeader>
    <TextLink asChild><Link to={path(failed ? "/check-email" : "/login")}>{failed ? t("auth.backToCheckEmail") : t("common.login")}</Link></TextLink>
  </AuthLayout>;
}
