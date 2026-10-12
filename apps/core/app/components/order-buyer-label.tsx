import { MessageCircle } from "lucide-react";

type Buyer = { name: string | null; phone: string | null } | null;

// Text is name ?? phone; `generalPublic` is only for orders without an OrderBuyer.
export function orderBuyerText(buyer: Buyer, generalPublic: string) {
  return buyer === null ? generalPublic : buyer.name ?? buyer.phone;
}

export function WhatsAppMark() {
  return <MessageCircle role="img" aria-label="WhatsApp" className="size-4 shrink-0 text-success" />;
}
