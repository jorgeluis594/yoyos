import { createContext } from "react-router";
import type { ReadyAccess } from "@core/src/features/users";

export const privateUserContext = createContext<ReadyAccess>();
