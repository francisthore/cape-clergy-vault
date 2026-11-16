import { useCallback, useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { accountRequest, type AccountState } from "./client";

import { AccountContext } from "./account-context";
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<AccountState>({ status: "loading" });
  const generation = useRef(0);
  const location = useRouterState({ select: (state) => state.location.href });
  const refresh = useCallback(() => {
    const current = ++generation.current;
    // Drop privileged links before every live check; never restore from browser storage.
    setAccount({ status: "loading" });
    void accountRequest("account").then(
      (result) => {
        if (generation.current === current)
          setAccount({ ...result, status: result.status ?? "error" });
      },
      () => {
        if (generation.current === current) setAccount({ status: "error" });
      },
    );
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 30000);
    const visibility = () => {
      if (document.visibilityState === "visible") refresh();
      else {
        generation.current++;
        setAccount({ status: "loading" });
      }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("cape-account-changed", refresh);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      // Async request generation is deliberately invalidated at cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("cape-account-changed", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh, location]);
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}
