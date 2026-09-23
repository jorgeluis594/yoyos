import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router";

export function meta() {
  return [{ title: "Yoyos" }];
}

export default function Home() {
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
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Yoyos</h1>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-primary underline underline-offset-4">Iniciar sesión</Link>
          <Button type="button" onClick={toggleTheme} aria-label="Alternar tema" aria-pressed={dark}>
            {dark ? "Modo claro" : "Modo oscuro"}
          </Button>
        </div>
      </div>
    </main>
  );
}
