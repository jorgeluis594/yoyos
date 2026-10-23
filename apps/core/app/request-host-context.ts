import { createContext } from "react-router";

/** Hostname as Express resolves it behind the trusted proxy; null outside the Express server (dev, tests). */
export const requestHostContext = createContext<string | null>(null);
