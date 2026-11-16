import { supabase } from "@/integrations/supabase/client";
import { flushOutbox } from "@/lib/outbox";

export async function sendQueuedMessages() {
  if (!navigator.onLine) return;
  const run = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return;
    const userId = data.user.id;
    await flushOutbox(userId, async (message) => {
      if (!navigator.onLine) return "retry";
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user?.id !== userId) return "retry";
      // RLS checks current consent and reviewer roles on every attempt.
      const { error: insertError } = await supabase.from("chat_messages").insert({
        id: message.id,
        owner_id: message.ownerId,
        sender_id: userId,
        body: message.body,
      });
      if (!insertError) return "sent";
      if (insertError.code === "23505") {
        const { data: existing } = await supabase
          .from("chat_messages")
          .select("id")
          .eq("id", message.id)
          .eq("sender_id", userId)
          .maybeSingle();
        return existing ? "sent" : "blocked";
      }
      if (
        insertError.code === "42501" ||
        insertError.code === "23503" ||
        insertError.code === "23514"
      )
        return "blocked";
      return "retry";
    });
  };
  if (navigator.locks)
    await navigator.locks.request("teft-outbox-send", { ifAvailable: true }, async (lock) => {
      if (lock) await run();
    });
  else await run();
}
