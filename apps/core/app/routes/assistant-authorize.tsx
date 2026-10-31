import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { data, Link, redirect, useFetcher, useLoaderData, useLocation, type ActionFunctionArgs, type ClientActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { isLocale, localizedPath } from "@core/app/locale";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { AuthLayout, AuthLayoutHeader, AuthLayoutTitle } from "@core/app/components/ui/auth-layout";
import { Button } from "@core/app/components/ui/button";
import { isWebUrl, redirectBrowser } from "@core/app/lib/redirect-browser";
import { lostResponse, lostResponseStatus } from "@core/app/routes/lost-response";
import { log } from "@core/src/shared/infrastructure/logger";
import { auth } from "@core/src/shared/infrastructure/auth";
import { resolveCurrentAccess } from "@core/src/shared/infrastructure/current-user";
import { authorizationFor } from "@core/src/features/assistants/composition";
import { parseAgentName, returnTargetOf } from "@core/src/features/assistants/domain/assistant-connection";
import type { AssistantOwnerAccess, AuthorizeAssistantError, SignedAuthorizationRequest } from "@core/src/features/assistants/application/authorize-assistant";
import type { CompanyId, UserId } from "@shared/identity";

type ReturnTargetView = { kind: "web"; domain: string } | { kind: "this_device" };
type Screen =
  | { state: "ready"; agentName: string | null; returnTarget: ReturnTargetView; storeName: string; email: string; signed: string }
  | { state: "company_required"; signed: string }
  | { state: "unverified" }
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "unavailable" };
type Answer =
  | { answered: "allowed" | "denied"; redirectUrl: string }
  | { error: "invalid" | "expired" | "not_sent" | "in_doubt" };

/** The screen must not be framed (clickjacking, RFC 6819 §4.4.1.9) and carries a signed request, so it is never cached. */
export function headers() {
  return new Headers({ "Content-Security-Policy": "frame-ancestors 'none'", "X-Frame-Options": "DENY", "Cache-Control": "no-store" });
}

const localePrefix = (pathname: string) => {
  const segment = pathname.split("/")[1];
  return isLocale(segment) ? `/${segment}` : "";
};

export async function loader({ request }: LoaderFunctionArgs): Promise<Screen> {
  const url = new URL(request.url);
  const signed = url.search.slice(1);
  const result = await resolveCurrentAccess(request.headers);
  if (!result.success) {
    if (result.error.code === "UNAUTHENTICATED") throw redirect(`${localePrefix(url.pathname)}/login?${signed}`);
    throw new Response("Service unavailable", { status: 503 });
  }
  if (result.data.status === "verification_required") return { state: "unverified" };
  if (result.data.status === "company_required") return { state: "company_required", signed };
  const read = await authorizationFor(request).read(signed as SignedAuthorizationRequest);
  if (!read.success) return read.error.code === "REQUEST_EXPIRED" ? { state: "expired" } : read.error.code === "REQUEST_INVALID" ? { state: "invalid" } : { state: "unavailable" };
  const session = await auth.api.getSession({ headers: request.headers });
  if (session === null) throw redirect(`${localePrefix(url.pathname)}/login?${signed}`);
  const returnTarget = returnTargetOf(read.data.redirectUri) ?? { kind: "this_device" as const };
  return { state: "ready", agentName: parseAgentName(read.data.clientName), returnTarget, storeName: result.data.company.name, email: session.user.email, signed };
}

const formSchema = z.object({ intent: z.enum(["allow", "deny", "switch_account"]), request: z.string().min(1) });

function answerOf(error: AuthorizeAssistantError): Extract<Answer, { error: string }> {
  if (error.code === "REQUEST_EXPIRED") return { error: "expired" };
  if (error.code === "REQUEST_INVALID") return { error: "invalid" };
  // The request is the same: the owner can tap again.
  return { error: "not_sent" };
}

export async function action({ request }: ActionFunctionArgs) {
  const form = formSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!form.success) return data<Answer>({ error: "invalid" }, { status: 400 });
  const signed = form.data.request as SignedAuthorizationRequest;
  const oauthClientId = new URLSearchParams(signed).get("client_id") ?? "unknown";
  const prefix = localePrefix(new URL(request.url).pathname);
  if (form.data.intent === "switch_account") {
    // The signed request lives in the URL and is not bound to the session, so it survives the sign-out.
    const signedOut = await auth.api.signOut({ headers: request.headers, returnHeaders: true });
    throw redirect(`${prefix}/login?${signed}`, { headers: signedOut.headers });
  }
  const result = await resolveCurrentAccess(request.headers);
  if (!result.success) {
    if (result.error.code === "UNAUTHENTICATED") throw redirect(`${prefix}/login?${signed}`);
    return data<Answer>({ error: "not_sent" }, { status: 503 });
  }
  if (result.data.status !== "ready") return data<Answer>({ error: "invalid" }, { status: 403 });
  const access: AssistantOwnerAccess = { companyId: result.data.company.id as CompanyId, userId: result.data.user.id as UserId };
  const authorization = authorizationFor(request);
  const outcome = form.data.intent === "allow" ? await authorization.allow(signed, access) : await authorization.deny(signed, access);
  // A service that could not be reached is not an answer: the repository and the plugin adapter log it.
  const answer = outcome.success ? (form.data.intent === "allow" ? "allowed" : "denied") : outcome.error.code === "REQUEST_EXPIRED" ? "expired" : outcome.error.code === "REQUEST_INVALID" ? "invalid" : null;
  if (answer !== null) log.info({ event: "assistant_authorization_answered", companyId: access.companyId, userId: access.userId, oauthClientId, answer }, "assistant_authorization_answered");
  if (!outcome.success) return data<Answer>(answerOf(outcome.error), { status: outcome.error.code === "REQUEST_EXPIRED" || outcome.error.code === "REQUEST_INVALID" ? 400 : 503 });
  return data<Answer>({ answered: form.data.intent === "allow" ? "allowed" : "denied", redirectUrl: outcome.data });
}

// A request that never reached the server is not sent; a gateway failure after it left is in doubt. Repeating is safe: the upsert keeps one row.
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try { return await serverAction<typeof action>(); }
  catch (cause) {
    const lost = lostResponse(cause);
    if (!lost) throw cause;
    return data<Answer>({ error: lost === "offline" ? "not_sent" : "in_doubt" }, { status: lostResponseStatus });
  }
}

// A rejected answer leaves the screen as it is.
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: { actionResult?: unknown; defaultShouldRevalidate: boolean }) {
  return actionResult && typeof actionResult === "object" ? false : defaultShouldRevalidate;
}

function Message({ children }: { children: string }) {
  return <p role="status" className="text-base">{children}</p>;
}

export default function AssistantAuthorize() {
  const { t } = useTranslation();
  const screen = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof clientAction>();
  const { pathname } = useLocation();
  const answer = fetcher.data as Answer | undefined;
  const pending = fetcher.state !== "idle";
  const answered = answer && "answered" in answer ? answer : null;
  const allowing = pending && fetcher.formData?.get("intent") === "allow";

  useEffect(() => {
    if (answered && isWebUrl(answered.redirectUrl)) redirectBrowser(answered.redirectUrl);
  }, [answered]);

  const submit = (intent: "allow" | "deny" | "switch_account") => {
    if (screen.state !== "ready") return;
    void fetcher.submit({ intent, request: screen.signed }, { method: "post" });
  };

  if (answer && "error" in answer && (answer.error === "invalid" || answer.error === "expired")) {
    return <Frame title={t("assistants.navTitle")}><Message>{t(answer.error === "expired" ? "assistants.expiredRequest" : "assistants.invalidRequest")}</Message></Frame>;
  }
  if (screen.state === "invalid") return <Frame title={t("assistants.navTitle")}><Message>{t("assistants.invalidRequest")}</Message></Frame>;
  if (screen.state === "expired") return <Frame title={t("assistants.navTitle")}><Message>{t("assistants.expiredRequest")}</Message></Frame>;
  if (screen.state === "unavailable") return <Frame title={t("assistants.navTitle")}><Message>{t("assistants.unavailable")}</Message></Frame>;
  if (screen.state === "unverified") return <Frame title={t("assistants.navTitle")}><Message>{t("assistants.unverified")}</Message></Frame>;
  if (screen.state === "company_required") {
    return <Frame title={t("assistants.navTitle")}>
      <Message>{t("assistants.noCompany")}</Message>
      <Button asChild className="min-h-touch"><Link to={localizedPath(pathname, "/register")}>{t("assistants.createStore")}</Link></Button>
    </Frame>;
  }

  const returnLine = screen.returnTarget.kind === "web" ? t("assistants.returnsTo", { domain: screen.returnTarget.domain }) : t("assistants.returnsToDevice");
  const title = screen.agentName ? t("assistants.title", { agent: screen.agentName, store: screen.storeName }) : t("assistants.titleUnnamed", { store: screen.storeName });
  return <Frame title={title}>
    {screen.agentName && <p className="text-base">{t("assistants.declaredName")}</p>}
    <p className="text-base">{returnLine}</p>
    <section className="flex flex-col gap-2" aria-labelledby="can-see"><h2 id="can-see" className="text-base font-semibold">{t("assistants.canSeeTitle")}</h2>
      <ul className="list-disc pl-5 text-base"><li>{t("assistants.canSee1")}</li><li>{t("assistants.canSee2")}</li><li>{t("assistants.canSee3")}</li></ul></section>
    <section className="flex flex-col gap-2" aria-labelledby="never"><h2 id="never" className="text-base font-semibold">{t("assistants.neverTitle")}</h2>
      <ul className="list-disc pl-5 text-base"><li>{t("assistants.never1")}</li><li>{t("assistants.never2")}</li></ul></section>
    <p className="text-base">{t("assistants.footer")}</p>
    <p className="text-base">{t("assistants.connectedAs", { email: screen.email })} · <Button type="button" variant="link" className="min-h-touch p-0" disabled={pending} onClick={() => submit("switch_account")}>{t("assistants.switchAccount")}</Button></p>
    <div aria-live="polite" className="flex flex-col gap-3">
      {answered && <Alert variant="success"><AlertDescription>{t(answered.answered === "allowed" ? "assistants.done" : "assistants.denied")}</AlertDescription></Alert>}
    </div>
    {answer && "error" in answer && <Alert variant="destructive" role="alert"><AlertDescription>{t(answer.error === "in_doubt" ? "assistants.inDoubt" : "assistants.notSent")}</AlertDescription></Alert>}
    {!answered && <div className="flex flex-col gap-3 sm:flex-row">
      <Button type="button" className="min-h-touch" disabled={pending} onClick={() => submit("allow")}>{allowing ? t("assistants.allowing") : t("assistants.allow")}</Button>
      <Button type="button" variant="outline" className="min-h-touch" disabled={pending} onClick={() => submit("deny")}>{t("assistants.deny")}</Button>
    </div>}
  </Frame>;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return <AuthLayout className="max-w-lg">
    <AuthLayoutHeader><AuthLayoutTitle>{title}</AuthLayoutTitle></AuthLayoutHeader>
    {children}
  </AuthLayout>;
}
