import { useEffect, useState } from "react";
import { subdomainErrorReason, type CatalogSettingsResponse, type SubdomainAvailabilityResponse } from "@shared/contracts/catalog";
import { isReservedCatalogSubdomain, parseCatalogSubdomain, type SubdomainFormatReason } from "@shared/catalog-subdomain";
import { checkSubdomainAvailability, readCatalogSettings, saveCatalogSubdomain, type LinkAnswer } from "@core/app/lib/catalog-link-client";

/** The pause after the last keystroke before a value is judged (initial value, adjustable). */
export const checkPauseMs = 400;

type VerdictKind =
  | Readonly<{ kind: "available" }>
  | Readonly<{ kind: "in_use"; raced: boolean }>
  | Readonly<{ kind: "reserved" }>
  | Readonly<{ kind: "invalid"; reason: SubdomainFormatReason }>
  | Readonly<{ kind: "current" }>
  | Readonly<{ kind: "check_failed" }>;
type Verdict = VerdictKind & Readonly<{ value: string }>;

/** What the status line says about the typed value; `help` covers empty, too short and "still waiting for the pause". */
export type LinkStatus =
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "saved" }>
  | VerdictKind;

/** What the last save did when it did not end in a verdict about the value. */
export type LinkPhase = "idle" | "saving" | "save_failed" | "in_doubt" | "reread_failed";

export type StatusInput = Readonly<{ value: string; paused: string; savedSubdomain: string | null; justSaved: boolean; verdict: Verdict | null }>;

/** Instant rules decide invalid, reserved and current with no request; only a free-looking, different name needs the route. */
export function deriveStatus({ value, paused, savedSubdomain, justSaved, verdict }: StatusInput): LinkStatus {
  // Every edit drops the previous verdict until the pause ends.
  if (value !== paused) return { kind: "help" };
  const parsed = parseCatalogSubdomain(value);
  if (!parsed.success) return parsed.error.reason === "too_short" ? { kind: "help" } : { kind: "invalid", reason: parsed.error.reason };
  if (value === savedSubdomain) return justSaved ? { kind: "saved" } : { kind: "current" };
  if (isReservedCatalogSubdomain(parsed.data)) return { kind: "reserved" };
  return verdict?.value === value ? verdict : { kind: "checking" };
}

export type CatalogLink = Readonly<{
  settings: CatalogSettingsResponse;
  value: string;
  status: LinkStatus;
  phase: LinkPhase;
  /** «Tu link no se guardó.» stays until the next edit. */
  notSaved: boolean;
  /** Saving or in doubt: the field, Guardar link and the switch are disabled. */
  busy: boolean;
  canSave: boolean;
  /** The seller edited the field away from the saved link, or else from the suggestion, or else from empty. */
  unsaved: boolean;
  asking: boolean;
  focusTarget: "field" | "button" | null;
  edit: (raw: string) => void;
  save: () => void;
  confirmChange: () => void;
  cancelChange: () => void;
  retryCheck: () => void;
  retrySave: () => void;
  clearFocus: () => void;
}>;

export function useCatalogLink(initial: CatalogSettingsResponse): CatalogLink {
  const [settings, setSettings] = useState(initial);
  // The suggestion only seeds the field once: later reads never put it back.
  const [seed] = useState(initial.subdomain ?? initial.suggestion ?? "");
  const [value, setValue] = useState(seed);
  const [paused, setPaused] = useState(seed);
  const [verdict, setVerdict] = useState<Verdict | null>(initial.subdomain === null && initial.suggestion ? { value: initial.suggestion, kind: "available" } : null);
  const [justSaved, setJustSaved] = useState(false);
  const [notSaved, setNotSaved] = useState(false);
  const [phase, setPhase] = useState<LinkPhase>("idle");
  const [asking, setAsking] = useState(false);
  const [focusTarget, setFocusTarget] = useState<"field" | "button" | null>(null);

  const status = deriveStatus({ value, paused, savedSubdomain: settings.subdomain, justSaved, verdict });
  const busy = phase === "saving" || phase === "in_doubt" || phase === "reread_failed";
  const canSave = !busy && (status.kind === "available" || status.kind === "check_failed");

  useEffect(() => {
    if (value === paused) return;
    const timer = setTimeout(() => setPaused(value), checkPauseMs);
    return () => clearTimeout(timer);
  }, [value, paused]);

  // Latest value only: leaving the effect aborts the wait for an older value.
  const checking = status.kind === "checking";
  useEffect(() => {
    if (!checking) return;
    const controller = new AbortController();
    void checkSubdomainAvailability(paused, controller.signal).then((answer) => {
      if (controller.signal.aborted) return;
      setVerdict(answerVerdict(paused, answer));
    });
    return () => controller.abort();
  }, [checking, paused]);

  function edit(raw: string) {
    setValue(raw.toLowerCase());
    setJustSaved(false);
    setNotSaved(false);
    if (phase !== "idle") setPhase("idle");
  }

  async function submit(target: string) {
    const raced = verdict?.value === target && verdict.kind === "available";
    setPhase("saving");
    setAsking(false);
    const answer = await saveCatalogSubdomain(target);
    if (answer.kind === "answered" && answer.ok) {
      setSettings(answer.body);
      setVerdict(null);
      setJustSaved(true);
      setPhase("idle");
      setFocusTarget("field");
      return;
    }
    if (answer.kind === "answered") {
      const reason = subdomainErrorReason(answer.error);
      const refused: Verdict | null = answer.error.code === "SUBDOMAIN_TAKEN" ? { value: target, kind: "in_use", raced }
        : answer.error.code === "SUBDOMAIN_RESERVED" ? { value: target, kind: "reserved" }
        : reason ? { value: target, kind: "invalid", reason } : null;
      setVerdict(refused);
      setPhase(refused ? "idle" : "save_failed");
      setFocusTarget("button");
      return;
    }
    if (answer.kind === "not_sent") {
      setPhase("save_failed");
      setFocusTarget("button");
      return;
    }
    await reread(target);
  }

  /** The save may have committed: reading is the safe way to find out, because saving the same value again is idempotent. */
  async function reread(target: string) {
    setPhase("in_doubt");
    const answer = await readCatalogSettings();
    if (answer.kind !== "answered" || !answer.ok) { setPhase("reread_failed"); return; }
    setSettings(answer.body);
    setPhase("idle");
    if (answer.body.subdomain === target) {
      setVerdict(null);
      setJustSaved(true);
      setFocusTarget("field");
      return;
    }
    // Not saved: the typed value stays and is judged again, and the message stays until the next edit.
    setNotSaved(true);
    setVerdict(null);
    setPaused(target);
    setFocusTarget("button");
  }

  function save() {
    if (!canSave) return;
    if (settings.subdomain !== null && value !== settings.subdomain) setAsking(true);
    else void submit(value);
  }

  return {
    settings, value, status, phase, notSaved, busy, canSave, asking, focusTarget,
    unsaved: value !== (settings.subdomain ?? seed),
    edit, save,
    confirmChange: () => void submit(value),
    cancelChange: () => setAsking(false),
    retryCheck: () => setVerdict(null),
    retrySave: () => void submit(value),
    clearFocus: () => setFocusTarget(null),
  };
}

/** A check that was not sent, got no answer or was refused (429 included) is «No pudimos revisar»: the save checks again. */
function answerVerdict(value: string, answer: LinkAnswer<SubdomainAvailabilityResponse>): Verdict {
  if (answer.kind !== "answered" || !answer.ok) return { value, kind: "check_failed" };
  const verdict = answer.body;
  return verdict.status === "invalid" ? { value, kind: "invalid", reason: verdict.reason }
    : verdict.status === "in_use" ? { value, kind: "in_use", raced: false }
    : { value, kind: verdict.status };
}
