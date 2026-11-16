import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clearLocalMessages } from "@/lib/outbox";
import { sendQueuedMessages } from "@/lib/outbox-delivery";
import { registerAppWorker } from "@/lib/pwa-registration";

export function MessageSync() {
  const qc = useQueryClient();
  useEffect(() => {
    let running = false;
    const sync = async () => {
      if (running) return;
      running = true;
      try {
        await sendQueuedMessages();
      } catch {
        /* Retain local messages for the next connection. */
      } finally {
        running = false;
      }
    };
    const changed = () => qc.invalidateQueries({ queryKey: ["chat"] });
    const visibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    registerAppWorker().catch(() => {});
    sync();
    const interval = window.setInterval(sync, 10000);
    window.addEventListener("online", sync);
    window.addEventListener("teft-outbox", sync);
    window.addEventListener("teft-outbox", changed);
    document.addEventListener("visibilitychange", visibility);
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearLocalMessages().catch(() => {});
        qc.clear();
      }
      if (event === "SIGNED_IN") window.setTimeout(sync, 0);
    });
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", sync);
      window.removeEventListener("teft-outbox", sync);
      window.removeEventListener("teft-outbox", changed);
      document.removeEventListener("visibilitychange", visibility);
      data.subscription.unsubscribe();
    };
  }, [qc]);
  return null;
}
