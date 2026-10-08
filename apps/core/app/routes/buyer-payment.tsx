import { useRef, useState } from "react";
import { redirect, isRouteErrorResponse, useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import { buyerPaymentViewSchema, reportPaymentResponseSchema } from "@shared/contracts/orders";
import { imageResponseSchema } from "@shared/contracts/images";
import { orders } from "@core/src/features/orders/composition";
import { formatCurrency } from "@core/app/format-currency";
import { Button } from "@core/app/components/ui/button";
import { Input } from "@core/app/components/ui/input";

export async function loader({ params }: LoaderFunctionArgs) {
  const result = await orders.getBuyerPaymentView(params.orderId ?? "");
  if (!result.success && result.error.code === "CHECKOUT_UNAVAILABLE") {
    const access = await orders.resolveBuyerAccess(params.orderId ?? "");
    if (access.success) throw redirect(`/checkout/${access.data.companyId}/${access.data.orderId}`);
  }
  if (!result.success) throw new Response("Pedido no disponible", { status: result.error.code === "ORDER_NOT_FOUND" ? 404 :
    result.error.code === "INVALID_ORDER" ? 400 : result.error.code === "ORDER_CANCELLED" ? 409 : 503 });
  return buyerPaymentViewSchema.parse(result.data);
}

export default function BuyerPayment() {
  const view = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [file, setFile] = useState<File | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const paymentId = useRef<string | null>(null);
  const money = (value: typeof view.total) => formatCurrency(value.amount, value.currency, "es-PE");
  const pendingReport = view.payments.some((payment) => payment.status === "reported");

  async function upload(selected: File) {
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
      setError("No se pudo subir la captura. Inténtalo de nuevo.");
    } finally { setUploading(false); }
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
      setError("No se pudo enviar el aviso. Tu captura sigue lista; vuelve a intentarlo.");
    } finally { setSubmitting(false); }
  }

  return <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
    <header className="flex items-center justify-between border-b pb-5"><span className="text-xl font-semibold">Yoyos</span><span className="text-sm text-muted-foreground">Pago de pedido</span></header>
    <div className="flex flex-col gap-2"><h1 className="text-3xl font-semibold tracking-tight">Pago del pedido</h1><p className="text-muted-foreground">Revisa las instrucciones de pago y avísanos cuando tengas tu comprobante.</p></div>
    <section aria-label="Resumen del pedido" className="rounded-lg border bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Total del pedido</span><strong className="text-xl tabular-nums">{money(view.total)}</strong></div>
      {view.deliveryCharge.amount > 0 && <div className="mt-3 flex items-center justify-between gap-4 text-sm"><span className="text-muted-foreground">Incluye entrega</span><span className="tabular-nums">{money(view.deliveryCharge)}</span></div>}
      <div className="mt-5 flex items-center justify-between gap-4 border-t pt-4"><span className="font-medium">Saldo pendiente</span><strong className="text-xl tabular-nums">{money(view.balanceDue)}</strong></div>
    </section>
    {view.paymentStatus === "paid" ? <section className="rounded-lg border bg-card p-5" role="status"><h2 className="text-lg font-semibold">Pedido pagado</h2><p className="text-muted-foreground">El pago de este pedido ya está confirmado.</p></section> : <>
      <section className="flex flex-col gap-4"><h2 className="text-xl font-semibold">Cómo pagar</h2>
        {view.settings.length === 0 ? <p className="rounded-lg border bg-card p-5 text-muted-foreground">El negocio aún no ha configurado sus datos de cobro. Contacta al vendedor.</p> :
          <div className="grid gap-4 sm:grid-cols-2">{view.settings.map((setting) => <article key={setting.method} className="flex flex-col gap-3 rounded-lg border bg-card p-5">
            <h3 className="font-semibold">{setting.method === "digital_wallet" ? "Billetera digital" : "Transferencia bancaria"}</h3>
            <dl className="flex flex-col gap-2 text-sm">{setting.method === "digital_wallet" ? <><div><dt className="text-muted-foreground">Proveedor</dt><dd>{setting.provider}</dd></div><div><dt className="text-muted-foreground">Titular</dt><dd>{setting.holder}</dd></div></> : <><div><dt className="text-muted-foreground">Banco</dt><dd>{setting.bank}</dd></div><div><dt className="text-muted-foreground">Titular</dt><dd>{setting.holder}</dd></div>{setting.accountNumber && <div><dt className="text-muted-foreground">Cuenta</dt><dd className="break-all tabular-nums">{setting.accountNumber}</dd></div>}{setting.cci && <div><dt className="text-muted-foreground">CCI</dt><dd className="break-all tabular-nums">{setting.cci}</dd></div>}</>}</dl>
            {setting.imageUrl && <img src={setting.imageUrl} alt={`Instrucciones de ${setting.method === "digital_wallet" ? "billetera digital" : "transferencia bancaria"}`} className="max-h-52 w-full rounded-md object-contain" />}
          </article>)}</div>}
      </section>
      {pendingReport || success ? <section role="status" className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Pago pendiente de revisión</h2><p className="mt-1 text-muted-foreground">El vendedor revisará la captura y confirmará el importe recibido.</p></section>
        : view.settings.length > 0 && <section className="flex flex-col gap-4 rounded-lg border bg-card p-5 sm:p-6"><div><h2 className="text-xl font-semibold">Ya pagué</h2><p className="mt-1 text-sm text-muted-foreground">Adjunta una captura del comprobante. El vendedor confirmará el pago.</p></div>
          <label htmlFor="receipt" className="text-sm font-medium">Captura del pago</label>
          <Input id="receipt" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || submitting} onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            setFile(selected); setImageId(null); paymentId.current = null; setSuccess(false);
            if (selected) void upload(selected);
          }} />
          {uploading && <p role="status" className="text-sm text-muted-foreground">Subiendo captura…</p>}
          {file && !imageId && !uploading && <Button type="button" variant="outline" onClick={() => void upload(file)}>Reintentar subida</Button>}
          {imageId && <p className="text-sm text-muted-foreground" role="status">Captura lista para enviar.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="button" disabled={!imageId || uploading || submitting} onClick={() => void submit()}>{submitting ? "Enviando…" : "Ya pagué"}</Button>
        </section>}
    </>}
    {view.payments.some((payment) => payment.receiptImageUrl) && <section className="flex flex-col gap-2"><h2 className="text-lg font-semibold">Comprobantes enviados</h2><ul className="flex flex-col gap-2">{view.payments.filter((payment) => payment.receiptImageUrl).map((payment) => <li key={payment.id}><a className="text-primary underline underline-offset-4" href={payment.receiptImageUrl!} target="_blank" rel="noreferrer">Ver captura · {payment.status === "reported" ? "Pendiente" : payment.status === "confirmed" ? "Confirmado" : "Anulado"}</a></li>)}</ul></section>}
  </main>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && (error.status === 404 || error.status === 400);
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4"><span className="text-xl font-semibold">Yoyos</span><h1 className="text-2xl font-semibold">{missing ? "Pedido no encontrado" : "No se pudo cargar el pago"}</h1><p className="text-muted-foreground">{missing ? "Revisa el enlace con el vendedor." : "Inténtalo de nuevo más tarde."}</p></main>;
}
