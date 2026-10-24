type Person = Readonly<{ name: string | null; phone: string | null }>;

/** Whether a saved delivery opens with «Otra persona recibe el pedido» checked: its recipient is not the buyer. */
export function otherPersonReceives(recipient: Readonly<{ name: string; phone: string }> | null | undefined, buyer: Person | null): boolean {
  if (!recipient) return false;
  return recipient.name.trim() !== (buyer?.name ?? "").trim() || recipient.phone.trim() !== (buyer?.phone ?? "").trim();
}
