import { createContext } from "react-router";

/** Client IP as Express resolves it behind the trusted proxy; null outside the Express server (dev, tests). */
export const clientIpContext = createContext<string | null>(null);
