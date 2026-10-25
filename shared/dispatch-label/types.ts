export type DispatchLabelDocument = Readonly<{
  type: "national_id" | "passport" | "foreign_id";
  number: string;
}>;
export type DispatchLabelLocation = Readonly<{ department: string; province: string; district: string }>;
type DispatchLabelRecipient = Readonly<{ name: string; phone: string }>;

type HomeDispatchLabel = Readonly<{
  method: "home";
  recipient: DispatchLabelRecipient & Readonly<{ document: DispatchLabelDocument | null }>;
  destination: Readonly<{ address: string; location: DispatchLabelLocation; reference: string | null }>;
  courier: string | null;
}>;
type AgencyDispatchLabel = Readonly<{
  method: "agency";
  recipient: DispatchLabelRecipient & Readonly<{ document: DispatchLabelDocument }>;
  destination: Readonly<{ agencyName: string; address: string; location: DispatchLabelLocation }>;
  courier: string;
}>;

/** Effective sender: the stored name (or the company name when empty) and an optional phone. */
export type DispatchLabelSender = Readonly<{ name: string; phone: string | null }>;

/** Only what the renderer draws; no payments, stock or network objects. `scheduledDate` is a calendar day (YYYY-MM-DD). */
export type DispatchLabel = Readonly<{ sender: DispatchLabelSender; orderNumber: number; scheduledDate: string | null }> & (HomeDispatchLabel | AgencyDispatchLabel);

export type DispatchLabelMissingField =
  | "recipientName" | "recipientPhone" | "recipientDocument" | "department" | "province" | "district"
  | "address" | "courier" | "agency";

export type DispatchLabelExclusion =
  | Readonly<{ code: "METHOD_NOT_APPLICABLE" }>
  | Readonly<{ code: "DELIVERY_NOT_ASSIGNED" }>
  | Readonly<{ code: "CANCELLED" }>
  | Readonly<{ code: "MISSING_DATA"; fields: readonly [DispatchLabelMissingField, ...DispatchLabelMissingField[]] }>
  | Readonly<{ code: "LABEL_CONTENT_OVERFLOW" }>;

/** One entry per selected order; `ReadError` is the adapter error of the failed read. */
export type DispatchLabelPreparation<ReadError> =
  | Readonly<{ status: "ready"; orderId: string; label: DispatchLabel }>
  | Readonly<{ status: "excluded"; orderId: string; exclusion: DispatchLabelExclusion }>
  | Readonly<{ status: "read-error"; orderId: string; error: ReadError }>;

/** Paper of one print job: one 62 x 100 mm label per page, or an A4 sheet of six cells. */
export type DispatchLabelSize = "label_62x100" | "a4";
