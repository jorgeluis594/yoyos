import { data } from "react-router";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/ui/error-state";

// Without a catch-all, unmatched URLs fail in the root middleware with a 500.
export const loader = () => data(null, { status: 404 });
export const meta = () => [{ name: "robots", content: "noindex, nofollow" }];

export default function NotFound() {
  const { t } = useTranslation();
  return <main className="p-6"><ErrorState title={t("notFoundPage.title")} description={t("notFoundPage.hint")} /></main>;
}
