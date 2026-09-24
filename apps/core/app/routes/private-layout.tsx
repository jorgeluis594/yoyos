import { useEffect, useRef, useState } from "react";
import { ChevronRight, House, LogOut, Menu, Moon, ShoppingBag, Sun, X } from "lucide-react";
import { Link, Outlet, createContext, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs, type MiddlewareFunction } from "react-router";
import { Button } from "@/components/ui/button";
import { privateUserContext } from "@/private-user-context";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { resolveCurrentUser } from "@core/src/shared/infrastructure/current-user";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
import { companyRepository } from "@core/src/features/companies/infrastructure/company-repository";
import { isLocale } from "@/locale";

const companyContext = createContext<{ name: string; country: string }>();

export const middleware: MiddlewareFunction<Response>[] = [async ({ request, context }, next) => {
  const path = new URL(request.url).pathname;
  const segment = path.split("/")[1];
  const locale = isLocale(segment) ? `/${segment}` : "";
  const user = await resolveCurrentUser(request.headers);
  if (!user) throw redirect(`${locale}/login`);
  if (!user.companyId) throw redirect(`${locale}/register`);
  const companyId = user.companyId;
  return withTenantIsolation(companyId, async () => {
    const company = await companyRepository.getIdentity(companyId);
    const correctPath = `/es-${company.country}/dashboard`;
    if (path !== correctPath) throw redirect(correctPath);
    context.set(privateUserContext, user);
    context.set(companyContext, company);
    return next();
  });
}];

export function loader({ context }: LoaderFunctionArgs) {
  const company = context.get(companyContext);
  return { company: company.name, home: `/es-${company.country}/dashboard`, name: context.get(privateUserContext).name };
}

function Navigation({ company, name, home, dark, pending, error, onTheme, onSignOut, onNavigate }: {
  company: string;
  name: string;
  home: string;
  dark: boolean;
  pending: boolean;
  error: string;
  onTheme: () => void;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col gap-6 bg-background px-4 pb-4 pt-3">
      <Link to={home} onClick={onNavigate} className="flex min-h-16 items-center gap-3 px-3 text-2xl font-semibold tracking-tight focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
        <ShoppingBag className="size-6 text-primary" aria-hidden="true" />yoyos
      </Link>
      <div className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card px-3 py-3 text-card-foreground">
        <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-secondary text-sm font-medium text-secondary-foreground" aria-hidden="true">{company.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="break-words text-sm font-medium leading-5">{company}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Espacio de trabajo</p>
        </div>
      </div>
      <nav aria-label="Navegación principal">
        <Link to={home} onClick={onNavigate} aria-current="page" className="flex min-h-11 items-center gap-3 rounded-sm bg-accent px-3 text-sm font-medium text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-md:min-h-12">
          <House className="size-5 shrink-0" aria-hidden="true" />Inicio
          <span className="ml-auto size-1.5 rounded-full bg-current" aria-hidden="true" />
        </Link>
      </nav>
      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
        <div className="flex min-w-0 items-center gap-3 px-3 pb-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 break-words text-sm font-medium leading-5">{name}</span>
        </div>
        <Button type="button" variant="ghost" className="min-h-11 w-full justify-start gap-3" onClick={onTheme} aria-label="Alternar tema" aria-pressed={dark}>
          {dark ? <Sun data-icon="inline-start" aria-hidden="true" /> : <Moon data-icon="inline-start" aria-hidden="true" />}
          {dark ? "Modo claro" : "Modo oscuro"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 w-full justify-start gap-3" onClick={onSignOut} disabled={pending}>
          <LogOut data-icon="inline-start" aria-hidden="true" />{pending ? "Cerrando sesión…" : "Cerrar sesión"}
        </Button>
        {error && <p role="alert" className="px-2 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}

export default function PrivateLayout() {
  const { company, home, name } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [dark, setDark] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

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

  function toggleTheme() {
    const next = !document.documentElement.classList.contains("dark");
    localStorage.setItem("yoyos-theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
  }

  async function signOut() {
    setPending(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw result.error;
      dialog.current?.close();
      navigate("/login");
    } catch {
      setError("No se pudo cerrar la sesión. Inténtalo de nuevo.");
      setPending(false);
    }
  }

  const navigation = { company, name, home, dark, pending, error, onTheme: toggleTheme, onSignOut: signOut };

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground">Saltar al contenido</a>
      <aside className="hidden md:sticky md:top-0 md:block md:h-dvh md:w-64 md:shrink-0 md:overflow-y-auto">
        <Navigation {...navigation} />
      </aside>
      <dialog ref={dialog} aria-label="Menú principal" className="m-0 h-dvh max-h-dvh w-72 max-w-full border-0 bg-background p-0 text-foreground shadow-xl backdrop:bg-foreground/40 md:hidden">
        <div className="flex h-full flex-col">
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar menú" className="absolute right-3 top-5 min-h-12 min-w-12" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></Button>
          <Navigation {...navigation} onNavigate={() => dialog.current?.close()} />
        </div>
      </dialog>
      <div className="min-w-0 flex-1 bg-card text-card-foreground md:my-3 md:mr-3 md:rounded-md md:border md:border-border">
        <header className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-2 text-sm sm:px-6">
          <Button type="button" variant="ghost" size="icon" aria-label="Abrir menú" aria-haspopup="dialog" className="min-h-12 min-w-12 md:hidden" onClick={() => dialog.current?.showModal()}><Menu aria-hidden="true" /></Button>
          <nav aria-label="Ruta de navegación" className="min-w-0">
            <ol className="flex min-w-0 items-center gap-3">
              <li className="min-w-0 truncate text-muted-foreground" title={company}>{company}</li>
              <li className="flex shrink-0 items-center gap-3" aria-current="page">
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">Inicio</span>
              </li>
            </ol>
          </nav>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-content px-4 py-8 outline-none sm:px-6"><Outlet /></main>
      </div>
    </div>
  );
}
