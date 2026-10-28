import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@core/app/components/ui/alert";
import { Badge } from "@core/app/components/ui/badge";
import { Button } from "@core/app/components/ui/button";
import { Checkbox } from "@core/app/components/ui/checkbox";
import { FieldError } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@core/app/components/ui/table";
import { productOptionLimits } from "@shared/contracts/products";
import {
  addCombination, applyBulk, copiedStockNotice, hiddenSelectedCount, inactiveSourceCount, isChipActive, moveOption, removeOption, removeRow, removeValue,
  setRow, toggleAll, toggleChip, uncreatedCombinations, uncreatedCount, undoRemoveOption, undoRemoveRow, undoRemoveValue,
  variantCounter, type Edit, type EditorDraft, type EditorOption, type RowPatch,
} from "@shared/product-variants";
import { applyOptionBuffer, bufferFromOption, newOptionBuffer, optionIssues, type OptionBuffer } from "@core/src/features/products/presentation/option-buffer";
import { OptionEditor } from "@core/src/features/products/presentation/option-editor";
import { rowViews, stockTotal, type FeedbackTargets, type RowView } from "@core/src/features/products/presentation/product-editor-model";
import { ReorderHandle, useReorder } from "@core/src/features/products/presentation/reorder";
import { BulkDialog, ConfirmDialog, RowDialog, type BulkKind } from "@core/src/features/products/presentation/variant-dialogs";

type Props = Readonly<{
  draft: EditorDraft;
  setDraft: (update: (draft: EditorDraft) => EditorDraft) => void;
  currency: string;
  originalNames: Readonly<Record<string, string>>;
  /** The detail of a saved variant; rows without one are not links. */
  variantHref?: (variantId: string) => string;
  targets: FeedbackTargets;
  /** Applies a buffer for an option that is not in the draft yet. The form syncs its own fields into the draft first. */
  commitOption: (buffer: OptionBuffer) => Edit;
  /** Back to a product without options, with the values the form had before the first one. */
  onClearOptions: () => void;
}>;

const { options: maxOptions, variants: maxVariants } = productOptionLimits;
const itemClass = "py-3 first:pt-0 last:pb-0";
const tagVariant = { new: "info", inactive: "secondary", removed: "warning", deleted: "destructive" } as const;

export function VariantsCard({ draft, setDraft, variantHref, currency, originalNames, targets, commitOption, onClearOptions }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<OptionBuffer | null>(null);
  const [notices, setNotices] = useState<Readonly<Record<string, string>>>({});
  const [valueNotices, setValueNotices] = useState<Readonly<Record<string, string>>>({});
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const [rowRef, setRowRef] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [version, setVersion] = useState(0);
  const [uncreatedOpen, setUncreatedOpen] = useState(false);
  const [uncreatedLimit, setUncreatedLimit] = useState(50);

  const optionIds = draft.options.map((option) => option.id);
  const reorder = useReorder(optionIds, (id, to) => setDraft((current) => moveOption(current, id, to)));
  const views = rowViews(draft);
  const liveViews = views.filter((view) => view.removal === null);
  const counter = variantCounter(draft);
  const liveOptions = draft.options.filter((option) => !option.marked);
  const visible = filter === null ? views : views.filter((view) => Object.values(view.row.combination).includes(filter));
  const selectedLive = liveViews.filter((view) => selected.includes(view.row.ref) && view.row.status === "active");
  const hidden = hiddenSelectedCount(draft, selected, filter);
  const selectableInView = liveViews.filter((view) => view.row.status === "active" && (filter === null || Object.values(view.row.combination).includes(filter)));
  const allActive = selectableInView.length > 0 && selectableInView.every((view) => selected.includes(view.row.ref));
  const stockNotice = copiedStockNotice(draft);
  const inactiveSources = inactiveSourceCount(draft);
  const noneActive = draft.saved && draft.options.length > 0 && !liveViews.some((view) => view.row.status === "active");
  const hasOptions = draft.options.length > 0;
  const sync = (edit: Edit, onFail?: (code: string) => void) => {
    if (edit.success) setDraft(() => edit.data);
    else onFail?.(edit.error.code);
    return edit.success;
  };

  function open(buffer: OptionBuffer) {
    setEditing(buffer);
  }
  function done() {
    if (!editing) return;
    const applied = editing.isNew ? commitOption(editing) : applyOptionBuffer(draft, editing);
    if (sync(applied)) setEditing(null);
  }
  function remove(buffer: OptionBuffer) {
    if (buffer.isNew) return setEditing(null);
    if (!draft.saved && liveOptions.length === 1) return setConfirmClear(true);
    const edit = removeOption(draft, buffer.optionId);
    if (sync(edit, (code) => setNotices({ [buffer.optionId]: code === "OPTION_HAS_SEVERAL_VALUES"
      ? t("productEditor.optionSeveralValues", { name: buffer.name }) : t("productEditor.optionLastInactive") }))) setEditing(null);
  }
  function removeFromEditor(valueId: string) {
    const name = draft.options.flatMap((option) => option.values).find((value) => value.id === valueId)?.name ?? "";
    const result = removeValue(draft, valueId);
    sync(result, (code) => setValueNotices({ [valueId]: code === "VALUE_FOR_EXISTING_VARIANTS"
      ? t("productEditor.valueForExistingKept", { name })
      : t("productEditor.valueBlocked", { name, count: !result.success && result.error.blocked ? result.error.blocked : 1 }) }));
  }
  const edit = (change: (current: EditorDraft) => EditorDraft) => setDraft(change);
  const editRow = (ref: string, patch: RowPatch) => edit((current) => setRow(current, ref, patch));
  const input = (ref: string, key: "salePrice" | "stock", text: string) => editRow(ref, { [key]: text === "" ? 0 : Number(text) });
  function applyBulkPatch(patch: RowPatch) {
    edit((current) => applyBulk(current, selectedLive.map((view) => view.row.ref), patch).draft);
    setVersion((current) => current + 1);
  }
  function removeSelected() {
    const refs = selectedLive.filter((view) => view.row.id === null).map((view) => view.row.ref);
    edit((current) => refs.reduce((draftNow, ref) => { const next = removeRow(draftNow, ref); return next.success ? next.data : draftNow; }, current));
    setSelected((current) => current.filter((ref) => !refs.includes(ref)));
  }
  const newSelected = selectedLive.filter((view) => view.row.id === null).length;

  const optionSummary = (option: EditorOption, index: number) => {
    const live = option.values.filter((value) => !value.marked);
    const kept = live.find((value) => value.id === option.valueForExistingVariants) ?? live[0];
    return <li key={option.id} {...reorder.itemProps(option.id)} className={`grid gap-2 ${itemClass}`}>
      <div className="flex flex-wrap items-center gap-2">
        <ReorderHandle id={option.id} name={option.name} position={index + 1} total={draft.options.length} onMove={reorder.move} announce={reorder.announce} dragProps={reorder.handleProps(option.id)} />
        <strong className={option.marked ? "line-through" : undefined}>{option.name}</strong>
        <ul className="flex flex-wrap gap-1.5" aria-label={option.name}>
          {option.values.map((value) => <li key={value.id}><Badge variant={value.marked ? "warning" : "outline"} className={value.marked ? "line-through" : undefined}>{value.name}</Badge></li>)}
        </ul>
        {!option.marked && <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => open(bufferFromOption(option))}>{t("productEditor.edit")}<span className="sr-only"> {option.name}</span></Button>}
      </div>
      {option.marked && <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <span>{option.saved ? t("productEditor.optionRemovedSaved", { name: option.name, value: kept?.name ?? "" }) : t("productEditor.optionRemovedNew", { name: option.name, value: kept?.name ?? "" })}</span>
        <Button type="button" variant="link" size="sm" onClick={() => edit((current) => undoRemoveOption(current, option.id))}>{t("productEditor.undo")}</Button>
      </p>}
      {option.values.filter((value) => value.marked).map((value) => {
        const count = draft.rows.filter((row) => row.id !== null && row.combination[option.id] === value.id).length;
        return <p key={value.id} className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span><s>{value.name}</s> · {value.saved ? t("productEditor.valueRemovedSaved", { name: value.name, count }) : t("productEditor.valueRemovedNew", { name: value.name })}</span>
          <Button type="button" variant="link" size="sm" onClick={() => edit((current) => undoRemoveValue(current, value.id))}>{t("productEditor.undo")}</Button>
          {(targets.blockedValues.has(value.id)) && <FieldError>{t("productEditor.valueBlockedNow", { name: value.name })}</FieldError>}
        </p>;
      })}
      {targets.options[option.id] && <FieldError>{targets.options[option.id]}</FieldError>}
    </li>;
  };

  const rowTag = (view: RowView) => view.tag && <Badge variant={tagVariant[view.tag]}>{{ new: t("productEditor.tagNew"), inactive: t("productEditor.tagInactive"), removed: t("productEditor.tagRemoved"), deleted: t("productEditor.tagDeleted") }[view.tag]}</Badge>;

  const tableRow = (view: RowView) => {
    const { row, label, removal } = view;
    const active = removal === null && row.status === "active";
    const error = targets.rows[row.ref];
    const unsaved = row.id === null;
    return <TableRow key={row.ref} data-removal={removal ?? undefined}>
      <TableCell className="w-10"><Checkbox aria-label={t("productEditor.selectRow", { label })} disabled={!active} checked={active && selected.includes(row.ref)}
        onCheckedChange={(checked) => setSelected((current) => checked ? [...current, row.ref] : current.filter((ref) => ref !== row.ref))} /></TableCell>
      <TableCell className="min-w-40">
        <div className="flex flex-wrap items-center gap-2">
          {unsaved && removal === null
            ? <Button type="button" variant="link" className="h-auto p-0" onClick={() => setRowRef(row.ref)}>{label}<span className="sr-only"> · {t("productEditor.openRow", { label })}</span></Button>
            : row.id !== null && removal === null && variantHref ? <Link to={variantHref(row.id)} className="underline-offset-4 hover:underline">{label}</Link>
            : <span className={removal ? "line-through" : undefined}>{label}</span>}
          {rowTag(view)}
          {removal === "self" && <Button type="button" variant="link" size="sm" onClick={() => edit((current) => undoRemoveRow(current, row.ref))}>{t("productEditor.undo")}</Button>}
        </div>
        {error && <FieldError>{error}</FieldError>}
      </TableCell>
      <TableCell className="w-32">{active
        ? <Input key={`${row.ref}:${version}`} type="number" inputMode="decimal" step="0.01" min="0.01" defaultValue={row.salePrice.toFixed(2)} aria-label={t("productEditor.salePriceOf", { label })} aria-invalid={Boolean(error) || undefined} onChange={(event) => input(row.ref, "salePrice", event.target.value)} />
        : <span>{row.salePrice.toFixed(2)}</span>}</TableCell>
      <TableCell className="w-24">{active && unsaved
        ? <Input key={`${row.ref}:${version}`} type="number" inputMode="numeric" step="1" min="0" defaultValue={row.stock} aria-label={t("productEditor.stockOf", { label })} onChange={(event) => input(row.ref, "stock", event.target.value)} />
        : <span>{row.stock}</span>}</TableCell>
      <TableCell className="w-10">{unsaved && removal === null &&
        <Button type="button" variant="ghost" size="icon" aria-label={t("productEditor.removeRow", { label })} onClick={() => edit((current) => { const next = removeRow(current, row.ref); return next.success ? next.data : current; })}><Trash2 aria-hidden="true" /></Button>}</TableCell>
    </TableRow>;
  };

  const uncreated = draft.saved && hasOptions ? uncreatedCount(draft) : 0;
  const page = uncreatedOpen ? uncreatedCombinations(draft, { offset: 0, limit: uncreatedLimit }) : null;
  const limitReached = counter.count >= maxVariants;
  const addUncreated = (combination: Readonly<Record<string, string>>) => edit((current) => { const next = addCombination(current, combination); return next.success ? next.data : current; });
  const single = uncreated === 1 ? uncreatedCombinations(draft, { limit: 1 }).items[0] : null;

  return <section aria-labelledby="variants-heading" className="grid gap-4">
    <h2 id="variants-heading" className="text-base font-semibold">{t("productEditor.variants")}</h2>
    {!hasOptions && !editing && <div className="grid gap-2">
      <div><Button type="button" variant="outline" onClick={() => open(newOptionBuffer(crypto.randomUUID()))}>{t("productEditor.addOptions")}</Button></div>
      <p className="text-sm text-muted-foreground">{t("productEditor.addOptionsHelp")}</p>
    </div>}
    {(hasOptions || editing) && <ul className="grid divide-y divide-border">
      {draft.options.map((option, index) => editing && editing.optionId === option.id
        ? <li key={option.id} className={itemClass}><OptionEditor draft={draft} buffer={editing} issues={optionIssues(draft, editing)} originalNames={originalNames} notice={notices[option.id] ?? targets.options[option.id]} valueNotices={{ ...valueNotices, ...targets.values }}
            onChange={setEditing} onDone={done} onDelete={() => remove(editing)} onRemoveValue={removeFromEditor} onUndoValue={(id) => edit((current) => undoRemoveValue(current, id))} /></li>
        : optionSummary(option, index))}
      {editing?.isNew && <li className={itemClass}><OptionEditor draft={draft} buffer={editing} issues={optionIssues(draft, editing)} originalNames={originalNames} notice={undefined} valueNotices={{}}
        onChange={setEditing} onDone={done} onDelete={() => remove(editing)} onRemoveValue={() => undefined} onUndoValue={() => undefined} /></li>}
    </ul>}
    {hasOptions && !editing && (draft.options.length >= maxOptions
      ? <p className="text-sm text-muted-foreground">{t("productEditor.maxOptions", { count: maxOptions })}</p>
      : <div className="grid gap-1"><div><Button type="button" variant="outline" onClick={() => open(newOptionBuffer(crypto.randomUUID()))}>{t("productEditor.addAnotherOption")}</Button></div>
          <p className="text-sm text-muted-foreground">{t("productEditor.optionsHelp", { count: maxOptions })}</p></div>)}
    <p aria-live="polite" className="sr-only">{reorder.announcement}</p>
    {noneActive && <Alert variant="warning"><AlertDescription>{t("productEditor.noActive")}</AlertDescription></Alert>}
    {hasOptions && <>
      {stockNotice !== null && <Alert variant="info"><AlertDescription>{t("productEditor.stockCopied", { count: stockNotice })}</AlertDescription></Alert>}
      {inactiveSources > 0 && <Alert variant="warning"><AlertDescription>{t("productEditor.inactiveSource", { count: inactiveSources })}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("productEditor.select")}>
        <span className="text-sm font-medium">{t("productEditor.select")}</span>
        <Chip active={allActive} onToggle={() => setSelected((current) => toggleAll(draft, current, filter))}>{t("productEditor.all")}</Chip>
        {liveOptions.flatMap((option) => option.values.filter((value) => !value.marked).map((value) => <Chip key={value.id} active={isChipActive(draft, selected, value.id, filter)} onToggle={() => setSelected((current) => toggleChip(draft, current, value.id, filter))}>{value.name}</Chip>))}
        <label className="ml-auto flex items-center gap-2 text-sm">{t("productEditor.filter")}
          <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={filter ?? ""} onChange={(event) => setFilter(event.target.value || null)}>
            <option value="">{t("productEditor.filterAny")}</option>
            {liveOptions.flatMap((option) => option.values.filter((value) => !value.marked).map((value) => <option key={value.id} value={value.id}>{option.name}: {value.name}</option>))}
          </select>
        </label>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">{t("productEditor.counter", { count: counter.count, max: counter.maximum })}{counter.inactive > 0 && ` · ${t("productEditor.counterInactive", { count: counter.inactive })}`}</p>
      {selectedLive.length > 0 && <div role="toolbar" className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-2 text-sm">
        <span>{t("productEditor.selected", { count: selectedLive.length })}{hidden > 0 && ` (${t("productEditor.hiddenByFilter", { count: hidden })})`}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => setBulk("salePrice")}>{t("productEditor.editSalePrice")}</Button>
        <Button type="button" size="sm" variant="outline" disabled={newSelected === 0} onClick={() => setBulk("stock")}>{t("productEditor.editStock")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setBulk("purchasePrice")}>{t("productEditor.editPurchasePrice")}</Button>
        {newSelected > 0 && <Button type="button" size="sm" variant="outline" onClick={removeSelected}>{t("productEditor.remove")}</Button>}
        <Button type="button" size="sm" variant="ghost" onClick={() => setSelected([])}>{t("productEditor.clearSelection")}</Button>
      </div>}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10" />
            <TableHead>{t("productEditor.colVariant")}</TableHead>
            <TableHead>{t("productEditor.colSalePrice")} ({currency})</TableHead>
            <TableHead>{t("productEditor.colStock")}</TableHead>
            <TableHead className="w-10" />
          </TableRow></TableHeader>
          <TableBody>{visible.map(tableRow)}</TableBody>
          <TableFooter><TableRow><TableCell /><TableCell>{t("productEditor.stockTotal")}</TableCell><TableCell /><TableCell>{stockTotal(draft)}</TableCell><TableCell /></TableRow></TableFooter>
        </Table>
      </div>
      {uncreated > 0 && <div className="grid gap-2 text-sm">
        {single ? <p className="flex flex-wrap items-center gap-2">{t("productEditor.uncreatedOne", { count: 1, label: single.label })}
            <Button type="button" size="sm" variant="outline" disabled={limitReached} aria-label={t("productEditor.addNamed", { label: single.label })} onClick={() => addUncreated(single.combination)}>{t("productEditor.add")}</Button>
            {limitReached && <span>{t("productEditor.limitReached", { count: maxVariants })}</span>}</p>
          : <p className="flex flex-wrap items-center gap-2">{t("productEditor.uncreatedMany", { count: uncreated })}
            <Button type="button" size="sm" variant="outline" aria-expanded={uncreatedOpen} onClick={() => setUncreatedOpen((current) => !current)}>{uncreatedOpen ? t("productEditor.hide") : t("productEditor.show")}</Button></p>}
        {page && !single && <ul className="grid gap-1">{page.items.map((item) => <li key={item.label} className="flex items-center gap-2">
          <span>{item.label}</span>
          <Button type="button" size="sm" variant="outline" disabled={limitReached} aria-label={t("productEditor.addNamed", { label: item.label })} onClick={() => addUncreated(item.combination)}>{t("productEditor.add")}</Button></li>)}
          {page.hasMore && <li><Button type="button" size="sm" variant="ghost" onClick={() => setUncreatedLimit((current) => current + 50)}>{t("productEditor.showMore")}</Button></li>}
          {limitReached && <li>{t("productEditor.limitReached", { count: maxVariants })}</li>}</ul>}
      </div>}
    </>}
    {bulk && <BulkDialog kind={bulk} selected={selectedLive.length} hidden={hidden} newCount={newSelected} onApply={applyBulkPatch} onClose={() => setBulk(null)} />}
    {rowRef && (() => {
      const view = views.find((candidate) => candidate.row.ref === rowRef);
      return view ? <RowDialog row={view.row} label={view.label} currency={currency}
        onDone={(patch) => { editRow(view.row.ref, patch); setVersion((current) => current + 1); }}
        onRemove={() => edit((current) => { const next = removeRow(current, view.row.ref); return next.success ? next.data : current; })}
        onClose={() => setRowRef(null)} /> : null;
    })()}
    {confirmClear && <ConfirmDialog title={t("productEditor.clearTitle")} description={t("productEditor.clearDescription", { count: liveViews.length })}
      confirm={t("productEditor.clearConfirm")} cancel={t("productEditor.clearKeep")}
      onConfirm={() => { setConfirmClear(false); setEditing(null); setSelected([]); onClearOptions(); }} onCancel={() => setConfirmClear(false)} />}
  </section>;
}

function Chip({ active, onToggle, children }: Readonly<{ active: boolean; onToggle: () => void; children: React.ReactNode }>) {
  return <Button type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={onToggle}>
    {active && <Check aria-hidden="true" data-icon="inline-start" />}{children}
  </Button>;
}
