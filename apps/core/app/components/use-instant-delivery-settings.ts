import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useFetcher, useRevalidator } from "react-router";
import type { DeliverySettingsResponse, DeliveryZonesResponse, SaveDeliverySettingsRequest } from "@shared/contracts/delivery-settings";

export const PICKUP_SAVE_DELAY_MS = 1500;

type Store = SaveDeliverySettingsRequest["store"];
export type Confirmed = Pick<DeliverySettingsResponse, "version" | "home" | "agency" | "store">;
export type SaveTarget = "store" | "home" | "agency";
export type PickupField = "name" | "address" | "instructions";
export type PickupDraft = Readonly<Record<PickupField, string>>;
export type SettingsChange = Readonly<{ method: "home" | "agency"; enabled: boolean }> | Readonly<{ method: "store"; store: Store }>;
export type SettingsActionResult = Readonly<{ saved: DeliverySettingsResponse }> | Readonly<{ error: "invalid" | "conflict" | "saveError" | "in_doubt" }>;
export type RowSaveState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "saving"; attempt: number }>
  | Readonly<{ kind: "saved" }>
  | Readonly<{ kind: "failed"; reason: "not_sent" | "in_doubt"; retry: SaveDeliverySettingsRequest }>
  | Readonly<{ kind: "conflict" }>;
export type PickupCommit =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "save"; store: Store }>
  | Readonly<{ kind: "invalid"; fields: readonly ("name" | "address")[] }>;

/** The confirmed settings with exactly one change applied: the server replaces the whole settings, guarded by the version. */
export function settingsRequest(confirmed: Confirmed, change: SettingsChange): SaveDeliverySettingsRequest {
  const request = { expectedVersion: confirmed.version, home: confirmed.home, agency: confirmed.agency, store: confirmed.store };
  return change.method === "store" ? { ...request, store: change.store } : { ...request, [change.method]: { enabled: change.enabled } };
}

export const pickupOf = (point: Confirmed["store"]["pickupPoint"]): PickupDraft =>
  ({ name: point?.name ?? "", address: point?.address ?? "", instructions: point?.instructions ?? "" });
const trimmed = (draft: PickupDraft): PickupDraft => ({ name: draft.name.trim(), address: draft.address.trim(), instructions: draft.instructions.trim() });
export const samePickup = (a: PickupDraft, b: PickupDraft) => {
  const [x, y] = [trimmed(a), trimmed(b)];
  return x.name === y.name && x.address === y.address && x.instructions === y.instructions;
};

/** What saving the pickup text means for the confirmed settings; an incomplete point is never sent. */
export function pickupCommit(confirmed: Confirmed, draft: PickupDraft, activating: boolean): PickupCommit {
  const point = trimmed(draft);
  if (!activating && samePickup(draft, pickupOf(confirmed.store.pickupPoint))) return { kind: "none" };
  if (point.name && point.address) {
    return { kind: "save", store: { enabled: confirmed.store.enabled || activating, pickupPoint: { name: point.name, address: point.address, instructions: point.instructions || null } } };
  }
  if (!confirmed.store.enabled && !activating && !point.name && !point.address && !point.instructions) return { kind: "save", store: { enabled: false, pickupPoint: null } };
  return { kind: "invalid", fields: (["name", "address"] as const).filter(field => !point[field]) };
}

/** The highest version among the loader and the saves of this screen: an older revalidation never overwrites a newer save. */
export function latestSettings(loaded: DeliverySettingsResponse, saved: DeliverySettingsResponse | undefined, zonesSaved: DeliveryZonesResponse | undefined): DeliverySettingsResponse {
  const full = saved && saved.version > loaded.version ? saved : loaded;
  return zonesSaved && zonesSaved.version > full.version ? { ...full, version: zonesSaved.version, home: zonesSaved.home, agency: zonesSaved.agency } : full;
}

const idle: RowSaveState = { kind: "idle" };
const notSent = (retry: SaveDeliverySettingsRequest): RowSaveState => ({ kind: "failed", reason: "not_sent", retry });

export function useInstantDeliverySettings({ loaded, zonesSaved, zonesBusy, ready }: Readonly<{
  loaded: DeliverySettingsResponse; zonesSaved: DeliveryZonesResponse | undefined; zonesBusy: boolean; ready: boolean;
}>) {
  const fetcher = useFetcher<SettingsActionResult>();
  const revalidator = useRevalidator();
  const saved = fetcher.data && "saved" in fetcher.data ? fetcher.data.saved : undefined;
  const settings = latestSettings(loaded, saved, zonesSaved);
  const [rows, setRows] = useState<Readonly<Record<SaveTarget, RowSaveState>>>({ store: idle, home: idle, agency: idle });
  const [inflight, setInflight] = useState<Readonly<{ attempt: number; target: SaveTarget; request: SaveDeliverySettingsRequest }> | null>(null);
  const [conflict, setConflict] = useState(false);
  const [activating, setActivating] = useState(false);
  const queued = useRef(false);
  const recommit = useRef<number | null>(null);
  const [draft, setDraft] = useState<PickupDraft>(() => pickupOf(settings.store.pickupPoint));
  const [blurred, setBlurred] = useState<readonly PickupField[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [handled, setHandled] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = inflight !== null || zonesBusy;
  const unsaved = !samePickup(draft, pickupOf(settings.store.pickupPoint));
  // Timers and blur handlers must see the current state, not the one of the render that created them.
  const latest = useRef({ settings, draft, activating, busy, conflict, ready, attempt });
  useEffect(() => { latest.current = { settings, draft, activating, busy, conflict, ready, attempt }; });

  const send = useCallback((target: SaveTarget, request: SaveDeliverySettingsRequest) => {
    if (navigator.onLine === false) { setRows(current => ({ ...current, [target]: notSent(request) })); return; }
    const number = latest.current.attempt + 1;
    setAttempt(number);
    setRows(current => ({ ...current, [target]: { kind: "saving", attempt: number } }));
    setInflight({ attempt: number, target, request });
    void fetcher.submit(request, { method: "post", encType: "application/json" });
  }, [fetcher]);

  // A result only counts for the attempt on screen; anything else is a late response.
  if (fetcher.state === "idle" && fetcher.data && handled !== fetcher.data) {
    setHandled(fetcher.data);
    if (inflight && inflight.attempt === attempt) {
      const { target, request } = inflight;
      const result = fetcher.data;
      setInflight(null);
      if ("saved" in result) {
        setRows(current => ({ ...current, [target]: { kind: "saved" } }));
        if (result.saved.store.enabled) setActivating(false);
      } else if (result.error === "conflict") {
        setConflict(true);
        setRows(current => ({ ...current, [target]: { kind: "conflict" } }));
      } else setRows(current => ({ ...current, [target]: result.error === "in_doubt" ? { kind: "failed", reason: "in_doubt", retry: request } : notSent(request) }));
    }
  }

  // A reload replaces the confirmed point but keeps the text that differs from the previous one.
  const point = useRef(pickupOf(settings.store.pickupPoint));
  const pointKey = JSON.stringify(settings.store.pickupPoint);
  useEffect(() => {
    const next = pickupOf(settings.store.pickupPoint);
    if (samePickup(latest.current.draft, point.current)) setDraft(next);
    point.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the serialized point
  }, [pointKey]);

  const commitPickup = useCallback(() => {
    clearTimeout(timer.current);
    const now = latest.current;
    if (now.conflict || !now.ready) return;
    if (now.busy) { queued.current = true; return; }
    const commit = pickupCommit(now.settings, now.draft, now.activating);
    if (commit.kind === "save") send("store", settingsRequest(now.settings, { method: "store", store: commit.store }));
  }, [send]);
  useEffect(() => {
    if (queued.current && !busy) { queued.current = false; commitPickup(); }
  }, [busy, commitPickup]);
  // Pickup text left unsaved by a conflict saves after the reload, without another blur or keystroke.
  useEffect(() => {
    // Only once the reloaded version is on screen: a conflict means the server version moved on.
    if (recommit.current !== null && !conflict && settings.version !== recommit.current) { recommit.current = null; commitPickup(); }
  }, [conflict, settings.version, commitPickup]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const changePickup = (field: PickupField, value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
    latest.current = { ...latest.current, draft: { ...latest.current.draft, [field]: value } };
    clearTimeout(timer.current);
    timer.current = setTimeout(commitPickup, PICKUP_SAVE_DELAY_MS);
  };
  const blurPickup = (field: PickupField) => {
    setBlurred(current => current.includes(field) ? current : [...current, field]);
    commitPickup();
  };

  const toggle = (method: SaveTarget, enabled: boolean) => {
    const now = latest.current;
    if (now.busy || now.conflict || !now.ready) return;
    if (method !== "store") { send(method, settingsRequest(now.settings, { method, enabled })); return; }
    const point = now.settings.store.pickupPoint;
    if (enabled && !point) {
      setActivating(true);
      // The fields render with the next commit.
      setTimeout(() => document.getElementById(now.draft.name.trim() ? "pickup-address" : "pickup-name")?.focus());
      return;
    }
    setActivating(false);
    if (enabled && point) send("store", settingsRequest(now.settings, { method: "store", store: { enabled: true, pickupPoint: point } }));
    else if (!enabled && now.settings.store.enabled && point) send("store", settingsRequest(now.settings, { method: "store", store: { enabled: false, pickupPoint: point } }));
  };
  const retry = (target: SaveTarget) => {
    const row = rows[target];
    if (row.kind === "failed" && !latest.current.busy) send(target, row.retry);
  };
  const reload = async () => {
    await revalidator.revalidate();
    recommit.current = latest.current.settings.version;
    setConflict(false);
    setRows({ store: idle, home: idle, agency: idle });
  };

  const blocker = useBlocker(({ currentLocation, nextLocation }) => unsaved && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const showing = (target: SaveTarget, enabled: boolean) => inflight?.target === target ? inflight.request[target].enabled : enabled;
  return {
    settings, rows, conflict, activating, draft, busy, blocker, unsaved, retry, reload, toggle, changePickup, blurPickup,
    checked: { store: showing("store", settings.store.enabled), home: showing("home", settings.home.enabled), agency: showing("agency", settings.agency.enabled) },
    // A required field the seller already left empty; the idle timer never marks untouched fields.
    invalidFields: (settings.store.enabled || activating || unsaved ? (["name", "address"] as const).filter(field => blurred.includes(field) && !draft[field].trim()) : []) as readonly ("name" | "address")[],
  };
}
