import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dispatchSenderNameMaxLength, dispatchSenderPhoneMaxLength, dispatchSenderResponseSchema, type DispatchSenderResponse } from "@shared/contracts/dispatch-sender";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Button } from "@core/app/components/ui/button";
import { Card, CardContent } from "@core/app/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { PICKUP_SAVE_DELAY_MS } from "@core/app/components/use-instant-delivery-settings";

export type SenderDraft = Readonly<{ name: string; phone: string }>;
export type SenderSaveState = Readonly<{ kind: "idle" | "saving" | "saved" }> | Readonly<{ kind: "failed"; draft: SenderDraft }>;
export type SaveSenderResult = Readonly<{ kind: "saved"; sender: DispatchSenderResponse }> | Readonly<{ kind: "failed" }>;

export const senderEndpoint = "/api/company/dispatch-sender";

export const draftOf = (sender: DispatchSenderResponse): SenderDraft => ({ name: sender.configured.name ?? "", phone: sender.configured.phone ?? "" });
export const sameDraft = (a: SenderDraft, b: SenderDraft) => a.name.trim() === b.name.trim() && a.phone.trim() === b.phone.trim();

/** The sender is saved on its own endpoint: it has no version, so it never conflicts with the delivery settings. */
export async function saveSender(draft: SenderDraft, send: typeof fetch = fetch): Promise<SaveSenderResult> {
  try {
    const response = await send(senderEndpoint, { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: draft.name.trim() || null, phone: draft.phone.trim() || null }) });
    if (!response.ok) return { kind: "failed" };
    const parsed = dispatchSenderResponseSchema.safeParse(await response.json());
    return parsed.success ? { kind: "saved", sender: parsed.data } : { kind: "failed" };
  } catch { return { kind: "failed" }; }
}

/** Saves on blur or after a short pause, one request at a time; the last text typed always ends up saved. */
function useSenderSave(initial: DispatchSenderResponse) {
  const [draft, setDraft] = useState<SenderDraft>(() => draftOf(initial));
  const [state, setState] = useState<SenderSaveState>({ kind: "idle" });
  const saved = useRef(draftOf(initial));
  const latest = useRef(draft);
  const inflight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const commit = useCallback(async () => {
    clearTimeout(timer.current);
    if (inflight.current || sameDraft(latest.current, saved.current)) return;
    inflight.current = true;
    try {
      // Text typed while a request is in flight is sent by the next turn of the loop.
      while (!sameDraft(latest.current, saved.current)) {
        const sending = latest.current;
        setState({ kind: "saving" });
        const result = await saveSender(sending);
        if (result.kind === "failed") { setState({ kind: "failed", draft: sending }); return; }
        saved.current = draftOf(result.sender);
      }
      setState({ kind: "saved" });
    } finally { inflight.current = false; }
  }, []);
  // Leaving the page flushes text typed since the last save; a request already in flight picks it up in its loop.
  useEffect(() => () => void commit(), [commit]);

  const change = (field: keyof SenderDraft, value: string) => {
    const next = { ...latest.current, [field]: value };
    latest.current = next;
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void commit(), PICKUP_SAVE_DELAY_MS);
  };
  // latest already holds the newest text, which includes the draft that failed.
  const retry = () => void commit();
  return { draft, state, change, blur: () => void commit(), retry };
}

/** The «Remitente» card of the delivery settings page: the sender printed on dispatch labels. */
export function DispatchSenderCard({ sender, companyName }: Readonly<{ sender: DispatchSenderResponse; companyName: string }>) {
  const { t } = useTranslation();
  const { draft, state, change, blur, retry } = useSenderSave(sender);
  return <Card id="sender" className="min-w-0 scroll-mt-6" role="region" aria-labelledby="sender-title"><CardContent className="flex min-w-0 flex-col gap-4 p-4">
    <div className="flex items-start gap-3">
      <Send aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id="sender-title" className="font-semibold leading-snug">{t("dispatchSender.title")}</h2>
        <p id="sender-description" className="text-sm text-muted-foreground">{t("dispatchSender.description")}</p>
      </div>
    </div>
    <FieldGroup className="sm:pl-7">
      <Field>
        <FieldLabel htmlFor="sender-name">{t("dispatchSender.name")}</FieldLabel>
        <Input id="sender-name" value={draft.name} placeholder={companyName} maxLength={dispatchSenderNameMaxLength} aria-describedby="sender-description"
          onChange={event => change("name", event.target.value)} onBlur={blur} />
      </Field>
      <Field>
        <FieldLabel htmlFor="sender-phone">{t("dispatchSender.phone")}</FieldLabel>
        <Input id="sender-phone" type="tel" value={draft.phone} maxLength={dispatchSenderPhoneMaxLength}
          onChange={event => change("phone", event.target.value)} onBlur={blur} />
      </Field>
      {state.kind === "saving" && <FieldDescription role="status">{t("deliverySettings.saving")}</FieldDescription>}
      {state.kind === "saved" && <FieldDescription role="status">{t("deliverySettings.rowSaved")}</FieldDescription>}
      {state.kind === "failed" && <Alert variant="destructive"><AlertDescription>{t("deliverySettings.notSent")}</AlertDescription>
        <Button type="button" variant="outline" className="mt-3 max-md:min-h-touch" onClick={retry}>{t("deliverySettings.retrySave")}</Button></Alert>}
    </FieldGroup>
  </CardContent></Card>;
}
