import { useTranslation } from "react-i18next";
import { localizedPath } from "@core/app/locale";
import { Link, useLocation, useSearchParams } from "react-router";

export default function AccountVerified() {
  const { t } = useTranslation();
  const location = useLocation();
  const path = (target: string) => localizedPath(location.pathname, target);
  const [params] = useSearchParams();
  const failed = params.has("error");
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4"><h1 className="text-2xl font-semibold">{failed ? t("auth.verificationFailedTitle") : t("auth.verifiedTitle")}</h1><p className="mt-3 text-muted-foreground">{failed ? t("auth.verificationFailedDescription") : t("auth.verifiedDescription")}</p><Link className="mt-6 underline" to={path(failed ? "/check-email" : "/login")}>{failed ? t("auth.backToCheckEmail") : t("common.login")}</Link></main>;
}
