import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { TextLink } from "@/components/ui/text-link";
import { Link, useLocation } from "react-router";
import { localizedPath } from "@core/app/locale";

export function meta() {
  return [{ title: "Yoyos" }];
}

export default function Home() {
  const { t } = useTranslation();
  const location = useLocation();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => {
      const preference = localStorage.getItem("yoyos-theme");
      const isDark = preference ? preference === "dark" : media.matches;
      document.documentElement.classList.toggle("dark", isDark);
      setDark(isDark);
    };

    syncTheme();
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, []);

  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains("dark");
    localStorage.setItem("yoyos-theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
  };

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6">
      <PageContainer className="max-w-7xl">
        <PageHeader className="items-center">
          <PageHeader.Heading><PageHeader.Title>Yoyos</PageHeader.Title></PageHeader.Heading>
          <PageHeader.Actions>
            <TextLink asChild><Link to={localizedPath(location.pathname, "/login")} className="text-sm">{t("common.login")}</Link></TextLink>
            <Button type="button" onClick={toggleTheme} aria-label={t("nav.toggleTheme")} aria-pressed={dark}>
              {dark ? t("nav.lightMode") : t("nav.darkMode")}
            </Button>
          </PageHeader.Actions>
        </PageHeader>
      </PageContainer>
    </main>
  );
}
