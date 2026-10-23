import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { AccessibilityInfo, findNodeHandle, type TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import type { CatalogSettingsResponse } from "@shared/contracts/catalog";
import { catalogSettings } from "@mobile/features/catalog/composition";
import { linkFieldState, needsServerCheck, type LinkFieldState, type LinkVerdict } from "@mobile/features/catalog/domain/catalog-link";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";

/** What the status line says besides the field state: the outcome of the last save. */
export type LinkNotice = "not_sent" | "failed" | "in_doubt" | "in_doubt_offline" | "not_saved";
type Phase = "idle" | "saving" | "rereading" | "doubt";

const pauseMilliseconds = 400;

/** Link state of the «Publicar catálogo» card: the typed value, the latest verdict and the save, with the last answer winning. */
export function useCatalogLink(settings: CatalogSettingsResponse | null, onSettings: (settings: CatalogSettingsResponse) => void, inputRef: RefObject<TextInput | null>) {
  const { t } = useTranslation();
  const [edited, setEdited] = useState<string | null>(null);
  const [pausedValue, setPausedValue] = useState<string | null>(null);
  // `undefined` is "no verdict yet": the untouched suggestion arrives already checked by core.
  const [verdict, setVerdict] = useState<LinkVerdict | null | undefined>(undefined);
  const [justSaved, setJustSaved] = useState(false);
  const [raceLost, setRaceLost] = useState(false);
  const [notice, setNotice] = useState<LinkNotice | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const latest = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const savedRef = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);

  const saved = settings?.subdomain ?? null;
  useEffect(() => { savedRef.current = saved; }, [saved]);
  const initial = saved ?? settings?.suggestion ?? "";
  const value = edited ?? initial;
  const suggestionVerdict: LinkVerdict | null = settings && saved === null && settings.suggestion !== null ? { status: "available", subdomain: settings.suggestion } : null;
  const currentVerdict = verdict === undefined ? suggestionVerdict : verdict;
  const settled = edited === null || pausedValue === edited;
  const field: LinkFieldState = !settings ? { kind: "empty" } : settled ? linkFieldState(value, saved, currentVerdict, justSaved) : { kind: "typing" };

  const check = useCallback((typed: string) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const id = ++latest.current;
    setVerdict(null);
    void catalogSettings.checkSubdomain(typed, request.signal).then(result => {
      if (id === latest.current && mounted.current) setVerdict(result.success ? result.data : { status: "check_failed" });
    });
  }, []);

  // Only the value where the seller paused is checked, and a format reason never flashes while typing.
  useEffect(() => {
    if (edited === null) return;
    const timer = setTimeout(() => {
      setPausedValue(edited);
      if (needsServerCheck(edited, savedRef.current)) check(edited);
    }, pauseMilliseconds);
    return () => clearTimeout(timer);
  }, [edited, check]);

  const edit = (text: string) => {
    const typed = text.toLowerCase();
    if (typed === value) return;
    latest.current += 1; controller.current?.abort();
    setEdited(typed); setVerdict(null); setJustSaved(false); setRaceLost(false); setNotice(null);
  };

  const finishSaved = (data: CatalogSettingsResponse, changed: boolean) => {
    onSettings(data);
    setVerdict(null); setJustSaved(true); setRaceLost(false); setNotice(null); setPhase("idle");
    // Guardar link is disabled now, so a screen reader moves to the field.
    const node = changed ? findNodeHandle(inputRef.current) : null;
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  };

  const reread = async (typed: string, changed: boolean) => {
    setPhase("rereading"); setNotice("in_doubt");
    const read = await catalogSettings.get();
    if (!mounted.current) return;
    if (!read.success) { setNotice("in_doubt_offline"); setPhase("doubt"); return; }
    if (read.data.subdomain === typed) { finishSaved(read.data, changed); return; }
    onSettings(read.data);
    setNotice("not_saved"); setPhase("idle");
    if (needsServerCheck(typed, read.data.subdomain)) check(typed);
  };

  const performSave = async (typed: string, changed: boolean) => {
    const wasAvailable = currentVerdict?.status === "available";
    setPhase("saving"); setNotice(null);
    const result = await catalogSettings.saveSubdomain(typed);
    if (!mounted.current) return;
    if (result.success) { finishSaved(result.data, changed); return; }
    const { error } = result;
    if (error.kind === "no_response") { await reread(typed, changed); return; }
    setPhase("idle");
    if (error.kind === "not_sent") { setNotice("not_sent"); return; }
    if (error.code === "SUBDOMAIN_TAKEN") { setVerdict({ status: "in_use", subdomain: typed }); setRaceLost(wasAvailable); return; }
    if (error.code === "SUBDOMAIN_RESERVED") { setVerdict({ status: "reserved" }); return; }
    if (error.code === "INVALID_SUBDOMAIN" && error.reason !== null) { setVerdict({ status: "invalid", reason: error.reason }); return; }
    // A session or company error is an answer: no re-read, the typed value stays.
    setNotice("failed");
  };

  const canSave = settings !== null && phase === "idle" && settled && (field.kind === "available" || field.kind === "check_failed");
  const submit = () => {
    if (!canSave) return;
    const changed = saved !== null && value !== saved;
    if (!changed) { void performSave(value, false); return; }
    showConfirmation({ title: t("catalogLinkChangeTitle"), description: t("catalogLinkChangeDescription", { host: `${saved}.${settings.domain}` }),
      confirmLabel: t("catalogLinkChange"), cancelLabel: t("catalogLinkKeep"), destructive: true, onConfirm: () => void performSave(value, true) });
  };
  /** Resends the same save (already confirmed) or repeats the check, whichever the status line is offering. */
  const retry = () => {
    if (notice === "not_sent" || notice === "failed" || notice === "in_doubt_offline") void performSave(value, saved !== null && value !== saved);
    else if (field.kind === "check_failed") check(value);
  };

  const retryable = notice === "not_sent" || notice === "failed" || notice === "in_doubt_offline" || ((notice === null || notice === "not_saved") && field.kind === "check_failed");
  return { value, field, notice, raceLost, phase, canSave, canRetry: retryable && phase !== "saving" && phase !== "rereading",
    hasUnsavedLink: edited !== null && edited !== initial, edit, submit, retry };
}
