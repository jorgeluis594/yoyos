import { useRef, useState, type ReactNode } from "react";
import { useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { reportPaymentResponseSchema, type BuyerPaymentView } from "@shared/contracts/orders";
import { imageResponseSchema } from "@shared/contracts/images";
import { formatCurrency } from "@core/app/format-currency";
import { Button } from "@core/app/components/ui/button";
import { Upload, X } from "lucide-react";

const card = "rounded-lg border bg-card p-4 sm:p-5";
const sectionTitle = "text-base font-semibold sm:text-lg";
const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function AmountRows({ view, money }: Readonly<{ view: BuyerPaymentView; money: (value: BuyerPaymentView["total"]) => string }>) {
  const { t } = useTranslation();
  return <dl className="flex flex-col gap-1 text-sm">
    <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">{t("buyerPaymentContent.total")}</dt><dd className="tabular-nums">{money(view.total)}</dd></div>
    {view.deliveryCharge.amount > 0 && <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">{t("buyerPaymentContent.includesDelivery")}</dt><dd className="tabular-nums">{money(view.deliveryCharge)}</dd></div>}
    <div data-store-part="total" className="flex items-center justify-between gap-3 border-t pt-2"><dt data-store-part="total-label" className="font-medium">{t("buyerPaymentContent.balanceDue")}</dt><dd data-store-part="total-amount" className="text-lg font-semibold tabular-nums">{money(view.balanceDue)}</dd></div>
  </dl>;
}

function Field({ label, children, className = "" }: Readonly<{ label: string; children: ReactNode; className?: string }>) {
  return <div className={`min-w-0 ${className}`}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm break-words">{children}</dd></div>;
}

export function BuyerPaymentContent({ view }: { view: BuyerPaymentView }) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const [method, setMethod] = useState(view.settings[0]?.method);
  const [copied, setCopied] = useState("");
  const selectedMethod = view.settings.find(setting => setting.method === method)?.method ?? view.settings[0]?.method;
  const [file, setFile] = useState<File | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const paymentId = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const money = (value: typeof view.total) => formatCurrency(value.amount, value.currency, "es-PE");
  const pendingReport = view.payments.some((payment) => payment.status === "reported");

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(t("buyerPaymentContent.copied", { label })); }
    catch { setCopied(t("buyerPaymentContent.copyFailed")); }
  }

  async function upload(selected: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type) || selected.size > 10 * 1024 * 1024) { setError(t("buyerPaymentContent.invalidImage")); return; }
    setUploading(true);
    setError("");
    const body = new FormData();
    body.append("file", selected);
    try {
      const response = await fetch(`/api/buyer/orders/${view.orderId}/images`, { method: "POST", body });
      const parsed = imageResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("upload");
      setImageId(parsed.data.id);
    } catch {
      setError(t("buyerPaymentContent.uploadFailed"));
    } finally { setUploading(false); }
  }

  function removeFile() {
    setFile(null); setImageId(null); setError(""); setSuccess(false); paymentId.current = null;
    if (input.current) { input.current.value = ""; input.current.focus(); }
  }

  async function submit() {
    if (!imageId || submitting) return;
    paymentId.current ??= crypto.randomUUID();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/buyer/orders/${view.orderId}/reports`, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentId: paymentId.current, receiptImageId: imageId }) });
      const parsed = reportPaymentResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("report");
      setSuccess(true);
      revalidator.revalidate();
    } catch {
      setError(t("buyerPaymentContent.reportFailed"));
    } finally { setSubmitting(false); }
  }

  const copyButton = (value: string, label: string, text: string) =>
    <Button size="sm" variant="ghost" className="h-7 px-2 text-[var(--link)]" onClick={() => void copy(value, label)}>{text}</Button>;
  const unavailable = view.availability !== "available" || view.paymentStatus === "paid";

  return <div className="flex flex-col gap-4">
    {unavailable && <section data-store-part="card" aria-label={t("buyerPaymentContent.summary")} className={card}><AmountRows view={view} money={money} /></section>}
    {view.availability !== "available" ? <section data-store-part="card" role="status" className={card}><h2 data-store-part="section-title" className={sectionTitle}>{t(view.availability === "delivery_quote_pending" ? "buyerPaymentContent.quotePendingTitle" : view.availability === "cancelled" ? "buyerPaymentContent.cancelledTitle" : "buyerPaymentContent.confirmTitle")}</h2><p className="mt-2 text-muted-foreground">{t(view.availability === "delivery_quote_pending" ? "buyerPaymentContent.quotePendingBody" : "buyerPaymentContent.contactStore")}</p></section> : view.paymentStatus === "paid" ? <section data-store-part="card" className={card} role="status"><h2 data-store-part="section-title" className={sectionTitle}>{t("buyerPaymentContent.paidTitle")}</h2><p className="text-muted-foreground">{t("buyerPaymentContent.paidBody")}</p></section> : <>
      <section data-store-part="card" className={`flex flex-col gap-3 ${card}`}><h2 data-store-part="section-title" className={sectionTitle}>{t("buyerPaymentContent.howToPay")}</h2>
        {view.settings.length === 0 ? <><p className="text-muted-foreground">{t("buyerPaymentContent.noSettings")}</p><AmountRows view={view} money={money} /></> :
          <div className="flex flex-col gap-3"><fieldset className="flex flex-wrap gap-2"><legend className="sr-only">{t("buyerPaymentContent.paymentMethod")}</legend>{view.settings.map(setting => <label key={setting.method} data-store-part="payment-method" className="flex min-h-11 min-w-32 flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm break-words has-[:checked]:border-primary has-[:checked]:bg-accent"><input type="radio" data-slot="radio-group-item" name="payment-method" value={setting.method} checked={selectedMethod === setting.method} onChange={() => setMethod(setting.method)} className="accent-[var(--accent-strong,var(--primary))]" />{setting.method === "digital_wallet" ? setting.provider : t("buyerPaymentContent.transfer")}</label>)}</fieldset>
          {view.settings.filter(setting => setting.method === selectedMethod).map((setting) => <article key={setting.method} data-store-part="payment-details" className="flex gap-3 rounded-md border p-3 sm:gap-4 sm:p-4">
            {setting.imageUrl && <a href={setting.imageUrl} target="_blank" rel="noreferrer" aria-label={t("buyerPaymentContent.openImage")} data-store-part="payment-image" className="block size-[8.5rem] shrink-0"><img src={setting.imageUrl} alt={t("buyerPaymentContent.instructions", { method: t(setting.method === "digital_wallet" ? "buyerPaymentContent.walletLower" : "buyerPaymentContent.bankTransferLower") })} className="size-full rounded-md object-contain" /></a>}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <h3 className="text-sm font-semibold">{t(setting.method === "digital_wallet" ? "buyerPaymentContent.wallet" : "buyerPaymentContent.bankTransfer")}</h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">{setting.method === "digital_wallet" ? <><Field label={t("buyerPaymentContent.provider")}>{setting.provider}</Field><Field label={t("buyerPaymentContent.holder")}>{setting.holder}</Field></> : <><Field label={t("buyerPaymentContent.bank")}>{setting.bank}</Field><Field label={t("buyerPaymentContent.holder")}>{setting.holder}</Field>{setting.accountNumber && <Field className="col-span-2" label={t("buyerPaymentContent.account")}><span className="tabular-nums break-all">{setting.accountNumber}</span> {copyButton(setting.accountNumber, t("buyerPaymentContent.account"), t("buyerPaymentContent.copyAccount"))}</Field>}{setting.cci && <Field className="col-span-2" label="CCI"><span className="tabular-nums break-all">{setting.cci}</span> {copyButton(setting.cci, "CCI", t("buyerPaymentContent.copyCci"))}</Field>}</>}</dl>
              <AmountRows view={view} money={money} />
            </div>
          </article>)}</div>}
        {copied && <p role="status" className="text-sm text-muted-foreground">{copied}</p>}
      </section>
      {pendingReport || success ? <section data-store-part="card" role="status" className={card}><h2 data-store-part="section-title" className="font-semibold">{t("buyerPaymentContent.pendingTitle")}</h2><p className="mt-1 text-muted-foreground">{t("buyerPaymentContent.pendingBody")}</p></section>
        : view.settings.length > 0 && <section data-store-part="card" className={`flex flex-col gap-2 ${card}`}><h2 data-store-part="section-title" className={sectionTitle}>{t("buyerPaymentContent.attachTitle")}</h2>
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-input bg-background p-3 focus-within:outline-2 focus-within:outline-ring sm:flex-row sm:items-center sm:justify-between">
            <label htmlFor="receipt" className="flex shrink-0 cursor-pointer items-center gap-3 text-sm font-medium"><Upload className="size-5 shrink-0 text-primary" aria-hidden="true" /><span className="flex min-w-0 flex-col"><span>{t("buyerPaymentContent.screenshot")}</span><span className="text-xs font-normal text-muted-foreground">{t("buyerPaymentContent.receiptHint")}</span></span>
              <input className="sr-only" id="receipt" ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || submitting} onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected); setImageId(null); paymentId.current = null; setSuccess(false);
                if (selected) void upload(selected);
              }} /></label>
            {file && <div data-testid="receipt-file" className="flex min-w-0 items-center sm:max-w-[55%] gap-2 rounded-md border bg-card px-2 py-1 text-sm"><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="shrink-0 text-xs text-muted-foreground">{fileSize(file.size)}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("buyerPaymentContent.removeFile")} disabled={uploading || submitting} onClick={removeFile}><X aria-hidden="true" /></Button></div>}
          </div>
          <p className="text-sm text-muted-foreground">{t("buyerPaymentContent.attachBody")}</p>
          {uploading && <p role="status" className="text-sm text-muted-foreground">{t("buyerPaymentContent.uploading")}</p>}
          {file && !imageId && !uploading && <Button type="button" variant="outline" onClick={() => void upload(file)}>{t("buyerPaymentContent.retryUpload")}</Button>}
          {imageId && <p className="text-sm text-muted-foreground" role="status">{t("buyerPaymentContent.ready")}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="button" className="h-12 w-full text-base" disabled={!imageId || uploading || submitting} onClick={() => void submit()}>{submitting ? t("buyerPaymentContent.sending") : t("buyerPaymentContent.paid")}</Button>
        </section>}
    </>}
    {view.payments.some((payment) => payment.receiptImageUrl) && <section className="flex flex-col gap-1"><h2 data-store-part="section-title" className={sectionTitle}>{t("buyerPaymentContent.sentReceipts")}</h2><ul className="flex flex-col gap-1 text-sm">{view.payments.filter((payment) => payment.receiptImageUrl).map((payment) => <li key={payment.id}><a className="text-[var(--link)] underline underline-offset-4" href={payment.receiptImageUrl!} target="_blank" rel="noreferrer">{t("buyerPaymentContent.viewScreenshot", { status: t(`buyerPaymentContent.status.${payment.status}`) })}</a></li>)}</ul></section>}
  </div>;
}
