import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, House, LogOut, Menu, Moon, ShoppingBag, Sun, X } from "lucide-react";
import { Link, Outlet, redirect, useLoaderData, useLocation, useNavigate, type LoaderFunctionArgs, type MiddlewareFunction } from "react-router";
import { Button } from "@/components/ui/button";
import { privateUserContext } from "@/private-user-context";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { resolveCurrentAccess } from "@core/src/shared/infrastructure/current-user";
import { requireCompany } from "@core/src/features/users";
import { authClient } from "@core/src/shared/infrastructure/auth-client";
import { isLocale } from "@/locale";

export const middleware: MiddlewareFunction<Response>[] = [async ({ request, context }, next) => {
  const path = new URL(request.url).pathname;
  const segment = path.split("/")[1];
  const locale = isLocale(segment) ? `/${segment}` : "";
  const result = await resolveCurrentAccess(request.headers);
  if (!result.success) {
    if (result.error.code === "UNAUTHENTICATED") throw redirect(`${locale}/login`);
    throw new Response("Service unavailable", { status: result.error.code === "PERSISTENCE_UNAVAILABLE" || result.error.code === "AUTH_SERVICE_UNAVAILABLE" ? 503 : 500 });
  }
  const ready = requireCompany(result.data);
  if (!ready.success) throw redirect(`${locale}/register`);
  const access = ready.data;
  return withTenantIsolation(access.company.id, async () => {
    const requestedPath = isLocale(segment) ? path.slice(segment.length + 1) : path;
    const correctPath = `/es-${access.company.country}${requestedPath}`;
    if (path !== correctPath) throw redirect(`${correctPath}${new URL(request.url).search}`);
    context.set(privateUserContext, access);
    return next();
  });
}];

export function loader({ context }: LoaderFunctionArgs) {
  const { company, user } = context.get(privateUserContext);
  return { company: company.name, home: `/es-${company.country}/dashboard`, name: user.name };
}

function Navigation({ company, name, home, productPath, active, dark, pending, error, onTheme, onSignOut, onNavigate }: {
  company: string;
  name: string;
  home: string;
  productPath: string;
  active: "home" | "products" | "new" | "detail";
  dark: boolean;
  pending: boolean;
  error: string;
  onTheme: () => void;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col gap-section bg-background px-4 pb-4 pt-3">
      <Link to={home} onClick={onNavigate} className="flex min-h-app-header items-center gap-3 px-3 text-2xl font-semibold tracking-tight focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
        <ShoppingBag className="size-icon-navigation text-primary" aria-hidden="true" />yoyos
      </Link>
      <div className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card px-3 py-3 text-card-foreground">
        <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-secondary text-sm font-medium text-secondary-foreground" aria-hidden="true">{company.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="break-words text-sm font-medium leading-5">{company}</p>
          <p className="mt-1 text-xs text-muted-foreground">Espacio de trabajo</p>
        </div>
      </div>
      <nav aria-label="Navegación principal">
        <Link to={home} onClick={onNavigate} data-slot="navigation-link" aria-current={active === "home" ? "page" : undefined} className={`flex min-h-control items-center gap-3 rounded-sm px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-md:min-h-touch ${active === "home" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent"}`}>
          <House className="size-icon-navigation shrink-0" aria-hidden="true" />Inicio
          {active === "home" && <Check className="ml-auto size-icon-inline" aria-hidden="true" />}
        </Link>
        <Link to={productPath} onClick={onNavigate} data-slot="navigation-link" data-active={active !== "home" ? "true" : undefined} aria-current={active === "products" ? "page" : undefined} className={`mt-1 flex min-h-control items-center gap-3 rounded-sm px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-md:min-h-touch ${active !== "home" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent"}`}>
          <ShoppingBag className="size-icon-navigation shrink-0" aria-hidden="true" />Productos
          {active !== "home" && <Check className="ml-auto size-icon-inline" aria-hidden="true" />}
        </Link>
      </nav>
      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
        <div className="flex min-w-0 items-center gap-3 px-3 pb-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 break-words text-sm font-medium leading-5">{name}</span>
        </div>
        <Button type="button" variant="ghost" className="min-h-control w-full justify-start gap-3" onClick={onTheme} aria-label="Alternar tema" aria-pressed={dark}>
          {dark ? <Sun data-icon="inline-start" aria-hidden="true" /> : <Moon data-icon="inline-start" aria-hidden="true" />}
          {dark ? "Modo claro" : "Modo oscuro"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-control w-full justify-start gap-3" onClick={onSignOut} disabled={pending}>
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
  const location = useLocation();
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

  const productPath = home.replace(/\/dashboard$/, "/products");
  const active: "home" | "products" | "new" | "detail" = location.pathname.endsWith("/products") ? "products" : location.pathname.endsWith("/products/new") ? "new" : location.pathname.includes("/products/") ? "detail" : "home";
  const navigation = { company, name, home, productPath, active, dark, pending, error, onTheme: toggleTheme, onSignOut: signOut };

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground">Saltar al contenido</a>
      <aside className="hidden md:sticky md:top-0 md:block md:h-dvh md:w-sidebar md:shrink-0 md:overflow-y-auto">
        <Navigation {...navigation} />
      </aside>
      <dialog ref={dialog} aria-label="Menú principal" className="m-0 h-dvh max-h-dvh w-navigation-drawer max-w-full border-0 bg-background p-0 text-foreground shadow-xl backdrop:bg-foreground/40 md:hidden">
        <div className="flex h-full flex-col">
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar menú" className="absolute right-3 top-4 min-h-touch min-w-touch" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></Button>
          <Navigation {...navigation} onNavigate={() => dialog.current?.close()} />
        </div>
      </dialog>
      <div className="min-w-0 flex-1 bg-card text-card-foreground md:my-3 md:mr-3 md:rounded-md md:border md:border-border">
        <header className="flex min-h-app-header items-center gap-3 border-b border-border px-page-mobile py-2 text-sm sm:px-page-desktop">
          <Button type="button" variant="ghost" size="icon" aria-label="Abrir menú" aria-haspopup="dialog" className="min-h-touch min-w-touch md:hidden" onClick={() => dialog.current?.showModal()}><Menu aria-hidden="true" /></Button>
          <nav aria-label="Ruta de navegación" className="min-w-0">
            <ol className="flex min-w-0 items-center gap-3">
              <li className="min-w-0 truncate text-muted-foreground" title={company}>{company}</li>
              <li className="flex shrink-0 items-center gap-3" aria-current="page">
                <ChevronRight className="size-icon-inline text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">{active === "home" ? "Inicio" : active === "products" ? "Productos" : active === "new" ? "Nuevo producto" : "Producto"}</span>
              </li>
            </ol>
          </nav>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-content px-page-mobile py-section outline-none sm:px-page-desktop"><Outlet /></main>
      </div>
    </div>
  );
}
