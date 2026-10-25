export type QrCheckRun<T> = Readonly<{ busy: true }> | Readonly<{ busy: false; value: T }>;

/** Bounds concurrent QR checks of the process: no queue, a check without a free slot is answered busy and never runs. */
export function createQrCheckLimiter(slots: number) {
  let inUse = 0;
  return {
    async run<T>(work: () => Promise<T>): Promise<QrCheckRun<T>> {
      if (inUse >= slots) return { busy: true };
      inUse++;
      try {
        return { busy: false, value: await work() };
      } finally {
        inUse--;
      }
    },
  };
}
