import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { data, useFetcher, useLoaderData, useRevalidator, type ActionFunctionArgs, type ClientActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { privateUserContext } from "@core/app/private-user-context";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent } from "@core/app/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/app/components/ui/dialog";
import { PageHeader } from "@core/app/components/ui/page-header";
import { formatLimaDate, formatLimaTime, isLimaToday } from "@core/app/lib/assistant-display";
import { lostResponse, lostResponseStatus } from "@core/app/routes/lost-response";
import { mcpResourceUrl } from "@core/src/shared/infrastructure/auth";
import { assistantConnections } from "@core/src/features/assistants/composition";
import type { AssistantConnectionId } from "@core/src/features/assistants/domain/assistant-connection";
import type { CompanyId, UserId } from "@shared/identity";

type ConnectionRow = { id: string; agentName: string | null; domain: string | null; connectedAt: string; lastUsedAt: string | null };
type Disconnected = { disconnected: string } | { error: "disconnect_failed"; id: string | null };

function ownerOf(context: LoaderFunctionArgs["context"]) {
  const access = context.get(privateUserContext);
  return { companyId: access.company.id as CompanyId, userId: access.user.id as UserId };
}

// A failed read keeps the address and the steps: the page offers Reintentar for the list only.
export async function loader({ context }: LoaderFunctionArgs) {
  const listed = await assistantConnections.list(ownerOf(context));
  const connections: ConnectionRow[] | null = listed.success
    ? listed.data.map((connection) => ({
      id: connection.id, agentName: connection.agentName,
      domain: connection.returnTarget.kind === "web" ? connection.returnTarget.domain : null,
      connectedAt: connection.authorizedAt.toISOString(), lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
    }))
    : null;
  return { address: mcpResourceUrl, connections };
}

const disconnectSchema = z.object({ intent: z.literal("disconnect"), connectionId: z.uuid() });

export async function action({ context, request }: ActionFunctionArgs) {
  const form = Object.fromEntries(await request.formData());
  const parsed = disconnectSchema.safeParse(form);
  const id = typeof form.connectionId === "string" ? form.connectionId : null;
  if (!parsed.success) return data<Disconnected>({ error: "disconnect_failed", id }, { status: 400 });
  const result = await assistantConnections.disconnect({ connectionId: parsed.data.connectionId as AssistantConnectionId }, ownerOf(context));
  return result.success ? data<Disconnected>({ disconnected: parsed.data.connectionId }) : data<Disconnected>({ error: "disconnect_failed", id: parsed.data.connectionId }, { status: 503 });
}

// Not sent and in doubt read the same here: the list reloads and shows whether the connection is still active.
export async function clientAction({ request, serverAction }: ClientActionFunctionArgs) {
  try { return await serverAction<typeof action>(); }
  catch (cause) {
    if (!lostResponse(cause)) throw cause;
    const id = await request.clone().formData().then((form) => { const value = form.get("connectionId"); return typeof value === "string" ? value : null; }, () => null);
    return data<Disconnected>({ error: "disconnect_failed", id }, { status: lostResponseStatus });
  }
}

function HowToConnect({ open }: { open: boolean }) {
  const { t } = useTranslation();
  return <details open={open} className="rounded-md border border-border px-4 py-3">
    <summary className="flex min-h-touch cursor-pointer items-center text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("assistants.howTitle")}</summary>
    <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm">
      <li>{t("assistants.step1")}</li><li>{t("assistants.step2")}</li><li>{t("assistants.step3")}</li>
    </ol>
    <p className="mt-3 text-sm text-muted-foreground">{t("assistants.planNote")}</p>
  </details>;
}

function Address({ address }: { address: string }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setMessage(t("assistants.copied")); }
    catch { setMessage(t("assistants.copyError")); }
  };
  return <section className="flex flex-col gap-3" aria-labelledby="address-heading">
    <h2 id="address-heading" className="text-lg font-semibold">{t("assistants.addressTitle")}</h2>
    <p id="connector-address" className="break-all text-sm select-all">{address}</p>
    <div><Button type="button" className="min-h-touch" onClick={() => void copy()}>{t("assistants.copy")}</Button></div>
    <div aria-live="polite" className="text-sm">{message}</div>
  </section>;
}

function Connections({ connections }: { connections: ConnectionRow[] }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof clientAction>();
  const [asking, setAsking] = useState<ConnectionRow | null>(null);
  const [lastAsked, setLastAsked] = useState<{ name: string; date: string } | null>(null);
  const focusAfter = useRef<{ removedId: string; nextId: string | null } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameOf = (row: ConnectionRow) => row.agentName ?? t("assistants.unnamed");

  const confirm = () => {
    if (asking === null) return;
    const index = connections.findIndex((row) => row.id === asking.id);
    focusAfter.current = { removedId: asking.id, nextId: connections[index + 1]?.id ?? null };
    setLastAsked({ name: nameOf(asking), date: formatLimaDate(asking.connectedAt) });
    void fetcher.submit({ intent: "disconnect", connectionId: asking.id }, { method: "post" });
  };

  const result = fetcher.data as Disconnected | undefined;
  const settled = fetcher.state === "idle" ? result : undefined;
  const failedId = settled && "error" in settled ? settled.id : null;
  const announcement = settled && "disconnected" in settled && lastAsked !== null ? t("assistants.disconnected", lastAsked) : "";

  // A failed disconnect leaves the row in place: focus goes back to its button.
  useEffect(() => {
    if (failedId === null) return;
    focusAfter.current = null;
    document.querySelector<HTMLButtonElement>(`[data-disconnect="${failedId}"]`)?.focus();
  }, [failedId, result]);

  // Once the list no longer holds the removed row, focus moves on.
  useEffect(() => {
    const pending = focusAfter.current;
    if (pending === null || connections.some((row) => row.id === pending.removedId)) return;
    focusAfter.current = null;
    const next = pending.nextId === null ? null : document.querySelector<HTMLButtonElement>(`[data-disconnect="${pending.nextId}"]`);
    (next ?? headingRef.current)?.focus();
  }, [connections]);

  const lastUse = (row: ConnectionRow) => row.lastUsedAt === null ? t("assistants.neverUsed")
    : isLimaToday(row.lastUsedAt, new Date()) ? t("assistants.lastUsedToday", { time: formatLimaTime(row.lastUsedAt) })
      : t("assistants.lastUsedOn", { date: formatLimaDate(row.lastUsedAt), time: formatLimaTime(row.lastUsedAt) });

  return <>
    <h2 id="connected-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("assistants.listTitle")}</h2>
    <div id="connection-announcement" aria-live="polite" className="text-sm">{announcement}</div>
    {connections.length === 0
      ? <p className="text-sm">{t("assistants.empty")}</p>
      : <ul className="flex flex-col gap-3">
        {connections.map((row) => <li key={row.id} data-connection className="flex flex-col gap-2 rounded-md border border-border p-4">
          <p className="text-base font-semibold">{nameOf(row)}</p>
          <p className="text-sm">{row.domain ?? t("assistants.thisDevice")}</p>
          <p className="text-sm">{t("assistants.connectedOn", { date: formatLimaDate(row.connectedAt) })}</p>
          <p className="text-sm">{lastUse(row)}</p>
          <div aria-live="polite" className="text-sm text-destructive">{failedId === row.id ? t("assistants.disconnectError") : null}</div>
          <div><Button type="button" variant="outline" className="min-h-touch" data-disconnect={row.id} disabled={fetcher.state !== "idle"} onClick={() => setAsking(row)}>{t("assistants.disconnect")}</Button></div>
        </li>)}
      </ul>}
    <p className="text-sm text-muted-foreground">{t("assistants.autoDisconnect")}</p>
    <Dialog open={asking !== null} onOpenChange={(open) => { if (!open) setAsking(null); }}>
      <DialogContent onCloseAutoFocus={(event) => { if (focusAfter.current !== null) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{asking && t("assistants.disconnectTitle", { name: nameOf(asking), date: formatLimaDate(asking.connectedAt) })}</DialogTitle>
          <DialogDescription>{t("assistants.disconnectBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-touch" onClick={() => { focusAfter.current = null; setAsking(null); }}>{t("assistants.keepConnected")}</Button>
          <Button type="button" variant="destructive" className="min-h-touch" onClick={() => { confirm(); setAsking(null); }}>{t("assistants.disconnectConfirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

export default function AssistantSettings() {
  const { t } = useTranslation();
  const { address, connections } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const revalidate = revalidator.revalidate;

  // An owner who connected in the agent and comes back sees the new row without reloading.
  useEffect(() => {
    const onFocus = () => { void revalidate(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [revalidate]);

  return <div className="flex flex-col gap-6">
    <PageHeader><PageHeader.Heading><PageHeader.Title>{t("assistants.navTitle")}</PageHeader.Title>
      <PageHeader.Description>{t("assistants.settingsIntro")}</PageHeader.Description></PageHeader.Heading></PageHeader>
    <Card><CardContent className="flex flex-col gap-5">
      <Address address={address} />
      <HowToConnect open={connections !== null && connections.length === 0 || connections === null} />
    </CardContent></Card>
    <Card><CardContent className="flex flex-col gap-4">
      {connections === null
        ? <>
          <h2 id="connected-heading" className="text-lg font-semibold">{t("assistants.listTitle")}</h2>
          <Alert variant="destructive" role="alert"><AlertDescription>{t("assistants.loadError")}</AlertDescription></Alert>
          <div><Button type="button" className="min-h-touch" onClick={() => void revalidate()}>{t("assistants.retry")}</Button></div>
        </>
        : <Connections connections={connections} />}
    </CardContent></Card>
  </div>;
}
