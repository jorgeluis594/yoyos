export type ReadSlot = Readonly<{ release: () => void; waitedMs: number }>;

/** A counting semaphore whose `acquire` gives up after `waitMs`; it runs before the transaction opens, so the wait is outside the transaction budget. */
export function createReadSlots(count: number, waitMs: number) {
  let free = count;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next(); else free += 1;
  };
  return {
    async acquire(): Promise<ReadSlot | null> {
      const started = Date.now();
      if (free > 0) { free -= 1; return { release, waitedMs: 0 }; }
      return new Promise((resolve) => {
        const grant = () => { clearTimeout(timer); resolve({ release, waitedMs: Date.now() - started }); };
        const timer = setTimeout(() => {
          const at = waiting.indexOf(grant);
          if (at >= 0) waiting.splice(at, 1);
          resolve(null);
        }, waitMs);
        waiting.push(grant);
      });
    },
  };
}
