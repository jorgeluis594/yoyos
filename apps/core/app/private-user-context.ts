import { createContext } from "react-router";
import type { resolveCurrentUser } from "@core/src/shared/infrastructure/current-user";

export const privateUserContext = createContext<NonNullable<Awaited<ReturnType<typeof resolveCurrentUser>>>>();
