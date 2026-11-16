import { createContext, useContext } from "react";
import type { AccountState } from "./client";
export const AccountContext = createContext<AccountState>({ status: "loading" });
export const useAccount = () => useContext(AccountContext);
