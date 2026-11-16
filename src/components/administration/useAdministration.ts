import { useCallback, useEffect, useRef, useState } from "react";
import { submissionRequest } from "@/lib/submissions/client";
// Drop protected lists on failed/hidden checks and fence late responses.
export function useAdministration<T>(query: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setData(null);
    if (!query || document.visibilityState === "hidden") return;
    setChecking(true);
    try {
      const result = await submissionRequest(`/api/administration?${query}`);
      if (generation.current === current) {
        setData(result);
        setMessage("");
      }
    } catch (error) {
      if (generation.current === current)
        setMessage(error instanceof Error ? error.message : "Service unavailable.");
    } finally {
      if (generation.current === current) setChecking(false);
    }
  }, [query]);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 30000);
    const check = () => void refresh();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      // Fence asynchronous responses after route/query changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [refresh]);
  return { data, message, checking, refresh };
}
export function useAdministrationAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const intent = useRef<{ body: string; requestId: string } | null>(null);
  const run = async (body: Record<string, unknown>, refresh: () => Promise<void>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    const serialized = JSON.stringify(body);
    if (intent.current?.body !== serialized)
      intent.current = { body: serialized, requestId: crypto.randomUUID() };
    try {
      const result = await submissionRequest("/api/administration", {
        ...body,
        requestId: intent.current.requestId,
      });
      setMessage(result.message);
      intent.current = null;
      await refresh();
      window.dispatchEvent(new Event("cape-account-changed"));
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Action unavailable. Refresh before trying again.",
      );
      // A denial must clear any stale protected list as well.
      await refresh();
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { run, busy, message };
}
