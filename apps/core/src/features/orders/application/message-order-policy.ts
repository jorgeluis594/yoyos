/** Retry policy of add-message-products-to-order; a leaf module so event-handlers can read it while loading. */
export const messageOrderPolicy = { concurrency: 2, retries: 8 } as const;
