/** `[from, before)` instants, Lima midnights: the window of a period of whole days. */
export type SalesWindow = Readonly<{ from: Date; before: Date }>;

/** What a sales read can answer besides a snapshot failure; shared by the summary and the product reads so neither imports a file of the other. */
export type SalesReadFailure = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_ORDER"; message: string }>;
