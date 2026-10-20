import { useEffect, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useTranslation } from "react-i18next";
import type { DeliverySettingsResponse, SaveDeliverySettingsRequest } from "@shared/contracts/delivery-settings";
import { deliverySettings } from "@mobile/features/delivery-settings/composition";
import { pickupCommit, pickupOf, samePickup, settingsRequest, type Confirmed, type PickupDraft, type PickupField, type RowSaveState, type SaveTarget } from "@mobile/features/delivery-settings/application/delivery-settings";
import { showConfirmation } from "@mobile/components/ui/show-confirmation";

export const PICKUP_SAVE_DELAY_MS = 1500;

type Rows = Readonly<Record<SaveTarget, RowSaveState>>;
const idle: RowSaveState = { kind: "idle" };
const idleRows: Rows = { store: idle, home: idle, agency: idle };
const unloaded: Confirmed = { version: 0, home: { enabled: false }, agency: { enabled: false }, store: { enabled: false, pickupPoint: null } };

/** One save at a time: method switches and the pickup point save as soon as they change, each from the last confirmed settings plus that change. */
export function useInstantDeliverySettings({ settings, zonesBusy, ready, onSaved, onReload }: Readonly<{
  settings: Confirmed | null; zonesBusy: boolean; ready: boolean; onSaved: (saved: DeliverySettingsResponse) => void; onReload: () => Promise<boolean>;
}>) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const confirmed = settings ?? unloaded;
  const [rows, setRows] = useState<Rows>(idleRows);
  const [inflight, setInflight] = useState<Readonly<{ target: SaveTarget; request: SaveDeliverySettingsRequest }> | null>(null);
  const [conflict, setConflict] = useState(false);
  const [activating, setActivating] = useState(false);
  const [draft, setDraft] = useState<PickupDraft>(() => pickupOf(confirmed.store.pickupPoint));
  const [blurred, setBlurred] = useState<readonly PickupField[]>([]);
  const attempt = useRef(0);
  const queued = useRef(false);
  const recommit = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fields = { name: useRef<TextInput>(null), address: useRef<TextInput>(null) };
  const busy = inflight !== null || zonesBusy;
  const unsaved = !samePickup(draft, pickupOf(confirmed.store.pickupPoint));
  // Timers and handlers must see the current state, not the one of the render that created them.
  const latest = useRef({ confirmed, draft, activating, busy, conflict, ready });
  useEffect(() => { latest.current = { confirmed, draft, activating, busy, conflict, ready }; });

  const send = async (target: SaveTarget, request: SaveDeliverySettingsRequest) => {
    const number = ++attempt.current;
    setRows(current => ({ ...current, [target]: { kind: "saving", attempt: number } }));
    setInflight({ target, request });
    const result = await deliverySettings.save(request);
    if (attempt.current !== number) return; // late response
    setInflight(null);
    if (result.success) {
      onSaved(result.data);
      setRows(current => ({ ...current, [target]: { kind: "saved" } }));
      if (result.data.store.enabled) setActivating(false);
    } else if (result.error.code === "DELIVERY_SETTINGS_CONFLICT") {
      setConflict(true);
      setRows(current => ({ ...current, [target]: { kind: "conflict" } }));
    } else {
      // A rejected request would fail again: only transport and server failures are worth retrying.
      const rejected = ["INVALID_DELIVERY_SETTINGS", "INVALID_INPUT", "PAYLOAD_TOO_LARGE"].includes(result.error.code);
      setRows(current => ({ ...current, [target]: rejected ? { kind: "invalid" } : { kind: "failed", reason: "not_sent", retry: request } }));
    }
  };

  // A reload replaces the confirmed point but keeps the text that differs from the previous one.
  const point = useRef(pickupOf(confirmed.store.pickupPoint));
  const pointKey = JSON.stringify(confirmed.store.pickupPoint);
  useEffect(() => {
    const next = pickupOf(confirmed.store.pickupPoint);
    if (samePickup(latest.current.draft, point.current)) setDraft(next);
    point.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the serialized point
  }, [pointKey]);

  const commitPickup = () => {
    clearTimeout(timer.current);
    const now = latest.current;
    if (now.conflict || !now.ready) return;
    if (now.busy) { queued.current = true; return; }
    const commit = pickupCommit(now.confirmed, now.draft, now.activating);
    if (commit.kind === "save") void send("store", settingsRequest(now.confirmed, { method: "store", store: commit.store }));
  };
  // Pickup text left behind by a busy lane or a conflict saves once the lane is free, without another blur or keystroke.
  useEffect(() => {
    if (!busy && !conflict && (queued.current || recommit.current)) { queued.current = false; recommit.current = false; commitPickup(); }
  });
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
    if (method !== "store") { void send(method, settingsRequest(now.confirmed, { method, enabled })); return; }
    const saved = now.confirmed.store.pickupPoint;
    if (enabled && !saved) {
      setActivating(true);
      // The fields render with the next commit.
      setTimeout(() => (now.draft.name.trim() ? fields.address : fields.name).current?.focus());
      return;
    }
    setActivating(false);
    if (saved && enabled !== now.confirmed.store.enabled) void send("store", settingsRequest(now.confirmed, { method: "store", store: { enabled, pickupPoint: saved } }));
  };
  const retry = (target: SaveTarget) => {
    const row = rows[target];
    if (row.kind === "failed" && !latest.current.busy) void send(target, row.retry);
  };
  const reload = async () => {
    if (!(await onReload())) return;
    recommit.current = true;
    setConflict(false);
    setRows(idleRows);
  };

  usePreventRemove(unsaved, ({ data }) => showConfirmation({ title: t("pickupLeave"), confirmLabel: t("pickupLeaveConfirm"), cancelLabel: t("pickupLeaveStay"),
    destructive: true, onConfirm: () => navigation.dispatch(data.action) }));

  const showing = (target: SaveTarget, enabled: boolean) => inflight?.target === target ? inflight.request[target].enabled : enabled;
  return {
    rows, conflict, activating, draft, busy, saving: inflight !== null, unsaved, fields, retry, reload, toggle, changePickup, blurPickup,
    checked: { store: showing("store", confirmed.store.enabled), home: showing("home", confirmed.home.enabled), agency: showing("agency", confirmed.agency.enabled) },
    // A required field the seller already left empty; the idle timer never marks untouched fields.
    invalidFields: (confirmed.store.enabled || activating || unsaved ? (["name", "address"] as const).filter(field => blurred.includes(field) && !draft[field].trim()) : []) as readonly ("name" | "address")[],
  };
}
