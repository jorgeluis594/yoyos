import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldError, FieldLabel } from "@core/app/components/ui/field";
import { Input } from "@core/app/components/ui/input";
import { productOptionLimits } from "@shared/contracts/products";
import type { EditorDraft } from "@shared/product-variants";
import type { OptionBuffer, OptionIssue } from "@core/src/features/products/presentation/option-buffer";
import { ReorderHandle, useReorder } from "@core/src/features/products/presentation/reorder";

type Props = Readonly<{
  draft: EditorDraft;
  buffer: OptionBuffer;
  issues: readonly OptionIssue[];
  /** The names the saved product had, to show «Antes …» next to a renamed value. */
  originalNames: Readonly<Record<string, string>>;
  /** A message from a refused removal or a rejected save, shown under the option. */
  notice?: string;
  valueNotices: Readonly<Record<string, string>>;
  onChange: (buffer: OptionBuffer) => void;
  onDone: () => void;
  onDelete: () => void;
  onRemoveValue: (valueId: string) => void;
  onUndoValue: (valueId: string) => void;
}>;

const lineClass = "flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground";

export function OptionEditor({ draft, buffer, issues, originalNames, notice, valueNotices, onChange, onDone, onDelete, onRemoveValue, onUndoValue }: Props) {
  const { t } = useTranslation();
  const option = draft.options.find((candidate) => candidate.id === buffer.optionId);
  const marked = new Set(option?.values.filter((value) => value.marked).map((value) => value.id));
  const [pendingId, setPendingId] = useState(() => crypto.randomUUID());
  const ids = buffer.values.map((value) => value.id);
  const reorder = useReorder(ids, (id, to) => {
    const from = buffer.values.findIndex((value) => value.id === id);
    if (from < 0) return;
    const rest = buffer.values.filter((value) => value.id !== id);
    rest.splice(to, 0, buffer.values[from]);
    onChange({ ...buffer, values: rest });
  });
  const nameIssue = issues.find((issue) => issue.kind === "NAME_REQUIRED" || issue.kind === "NAME_DUPLICATE" || issue.kind === "NAME_TOO_LONG");
  const nameText = nameIssue?.kind === "NAME_REQUIRED" ? t("productEditor.nameRequired")
    : nameIssue?.kind === "NAME_DUPLICATE" ? t("productEditor.nameDuplicate", { name: nameIssue.name })
    : nameIssue?.kind === "NAME_TOO_LONG" ? t("productEditor.tooLong", { count: productOptionLimits.nameLength }) : undefined;
  const valueText = (valueId: string) => {
    const issue = issues.find((candidate) => "valueId" in candidate && candidate.valueId === valueId);
    if (issue?.kind === "VALUE_DUPLICATE") return t("productEditor.valueDuplicate", { value: issue.text });
    if (issue?.kind === "VALUE_TOO_LONG") return t("productEditor.tooLong", { count: productOptionLimits.nameLength });
    if (issue?.kind === "VALUE_REQUIRED") return t("productEditor.valueRequired");
    return valueNotices[valueId];
  };
  const listIssues = issues.flatMap((issue) => issue.kind === "NO_VALUES" ? [t("productEditor.noValues")]
    : issue.kind === "TOO_MANY_VALUES" ? [t("productEditor.tooManyValues", { count: issue.maximum })]
    : issue.kind === "TOO_MANY_OPTIONS" ? [t("productEditor.maxOptions", { count: issue.maximum })] : []);
  const limit = issues.find((issue) => issue.kind === "TOO_MANY_VARIANTS");
  const limitText = limit?.kind !== "TOO_MANY_VARIANTS" ? undefined : limit.saved
    ? t("productEditor.limitSaved", { total: limit.projected, current: limit.current, added: limit.projected - limit.current })
    : t("productEditor.limitNew", { total: limit.projected, breakdown: limit.counts.map((item) => `${item.count} ${plural(item.name)}`).join(" × ") });

  function change(valueId: string, text: string) {
    onChange({ ...buffer, values: buffer.values.map((value) => value.id === valueId ? { ...value, text } : value) });
  }
  function typeNew(text: string) {
    if (text === "") return;
    onChange({ ...buffer, values: [...buffer.values, { id: pendingId, text }] });
    setPendingId(crypto.randomUUID());
  }
  function drop(valueId: string) {
    onChange({ ...buffer, values: buffer.values.filter((value) => value.id !== valueId), valueForExistingVariants: buffer.valueForExistingVariants === valueId ? null : buffer.valueForExistingVariants });
  }

  const blocked = issues.length > 0;
  const live = buffer.values.filter((value) => !marked.has(value.id));
  const position = (valueId: string) => live.findIndex((value) => value.id === valueId) + 1;
  const keptValue = buffer.valueForExistingVariants && live.some((value) => value.id === buffer.valueForExistingVariants) ? buffer.valueForExistingVariants : live[0]?.id ?? "";
  const existingCount = draft.rows.filter((row) => row.id !== null).length;
  const showExisting = draft.saved && (buffer.isNew || option?.saved === false) && live.length > 1 && existingCount > 0;

  return <section aria-label={t("productEditor.optionEditor", { name: buffer.name || t("productEditor.newOption") })} className="grid gap-4 rounded-lg border border-border bg-muted/30 p-4">
    <Field data-invalid={Boolean(nameText)}>
      <FieldLabel htmlFor={`option-name-${buffer.optionId}`}>{t("productEditor.optionName")}</FieldLabel>
      <Input id={`option-name-${buffer.optionId}`} value={buffer.name} aria-invalid={Boolean(nameText) || undefined} aria-describedby={nameText ? `option-name-error-${buffer.optionId}` : undefined}
        onChange={(event) => onChange({ ...buffer, name: event.target.value })} autoComplete="off" />
      {nameText && <FieldError id={`option-name-error-${buffer.optionId}`}>{nameText}</FieldError>}
    </Field>
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{t("productEditor.optionValues")}</legend>
      <ul className="grid gap-2">
        {[...buffer.values.map((value) => ({ ...value, pending: false })), { id: pendingId, text: "", pending: true }].map((value) => {
          if (marked.has(value.id)) {
            const name = option?.values.find((candidate) => candidate.id === value.id)?.name ?? value.text;
            const saved = option?.values.find((candidate) => candidate.id === value.id)?.saved ?? false;
            const count = draft.rows.filter((row) => row.id !== null && row.combination[buffer.optionId] === value.id).length;
            return <li key={value.id} className={lineClass}>
              <span><s>{name}</s> · {saved ? t("productEditor.valueRemovedSaved", { name, count }) : t("productEditor.valueRemovedNew", { name })}</span>
              <Button type="button" variant="link" size="sm" onClick={() => onUndoValue(value.id)}>{t("productEditor.undo")}</Button>
              {valueText(value.id) && <FieldError>{valueText(value.id)}</FieldError>}
            </li>;
          }
          const error = value.pending ? undefined : valueText(value.id);
          const original = originalNames[value.id];
          const index = position(value.id);
          return <li key={value.id} {...(value.pending ? {} : reorder.itemProps(value.id))} className="grid gap-1">
            <div className="flex items-center gap-2">
              {value.pending ? null : <ReorderHandle id={value.id} name={value.text || String(index)} position={index} total={live.length} onMove={reorder.move} announce={reorder.announce} dragProps={reorder.handleProps(value.id)} />}
              <Input value={value.text} className="min-w-0 flex-1" autoComplete="off" aria-invalid={Boolean(error) || undefined}
                aria-label={value.pending ? t("productEditor.addValue") : t("productEditor.valueLabel", { position: index, name: buffer.name || t("productEditor.newOption") })}
                placeholder={value.pending ? t("productEditor.addValue") : undefined}
                onChange={(event) => value.pending ? typeNew(event.target.value) : change(value.id, event.target.value)} />
              {value.pending ? null : <Button type="button" variant="ghost" size="icon" aria-label={t("productEditor.removeValue", { name: value.text })} onClick={() => option?.values.some((candidate) => candidate.id === value.id) ? onRemoveValue(value.id) : drop(value.id)}><Trash2 aria-hidden="true" /></Button>}
            </div>
            {error && <FieldError>{error}</FieldError>}
            {!value.pending && original !== undefined && original !== value.text.trim() && <p className="text-sm text-muted-foreground">{t("productEditor.renamedFrom", { name: original })}</p>}
          </li>;
        })}
      </ul>
      <p aria-live="polite" className="sr-only">{reorder.announcement}</p>
      {listIssues.map((text) => <FieldError key={text}>{text}</FieldError>)}
    </fieldset>
    {showExisting && <Field>
      <FieldLabel htmlFor={`existing-${buffer.optionId}`}>{t("productEditor.existingValueFor", { option: buffer.name || t("productEditor.newOption"), count: existingCount })}</FieldLabel>
      <select id={`existing-${buffer.optionId}`} className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={keptValue}
        onChange={(event) => onChange({ ...buffer, valueForExistingVariants: event.target.value })}>
        {live.map((value) => <option key={value.id} value={value.id}>{value.text}</option>)}
      </select>
      <p className="text-sm text-muted-foreground">{t("productEditor.existingValueHelp", { count: Math.max(0, (live.length - 1) * existingCount), value: live.find((value) => value.id !== keptValue)?.text ?? "" })}</p>
    </Field>}
    {limitText && <div role="alert" className="grid gap-1 text-sm text-destructive"><strong>{t("productEditor.tooManyVariants", { count: productOptionLimits.variants })}</strong><span>{limitText}</span></div>}
    {notice && <FieldError>{notice}</FieldError>}
    <div className="flex flex-wrap gap-3">
      <Button type="button" variant="destructive" onClick={onDelete}>{t("productEditor.deleteOption")}</Button>
      <Button type="button" onClick={onDone} disabled={blocked}>{t("productEditor.done")}</Button>
    </div>
  </section>;
}

/** «5 tallas × 6 colores»: the option name in lowercase and plural, as the limit message spells the product of the values. */
function plural(name: string): string {
  const lower = name.trim().toLowerCase();
  return /[aeiouáéíóú]$/.test(lower) ? `${lower}s` : `${lower}es`;
}
