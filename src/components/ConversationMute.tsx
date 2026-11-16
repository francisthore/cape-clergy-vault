import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";

export function ConversationMute({ userId, ownerId }: { userId: string; ownerId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const key = ["chat-mute", userId, ownerId];
  const { data, isPending, error } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_notification_preferences")
        .select("muted")
        .eq("user_id", userId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (error) throw error;
      return data?.muted ?? false;
    },
  });
  return (
    <label className="flex shrink-0 items-center gap-2 text-sm">
      {data ? <BellOff className="size-4" /> : <Bell className="size-4" />}
      <span>{error ? "Mute unavailable" : "Mute"}</span>
      <Switch
        aria-label="Mute conversation"
        checked={data ?? false}
        disabled={busy || isPending || !!error}
        onCheckedChange={async (muted) => {
          setBusy(true);
          const { error } = await supabase
            .from("chat_notification_preferences")
            .upsert({ user_id: userId, owner_id: ownerId, muted });
          if (error)
            toast.error("Could not update mute settings. Check your connection and access.");
          else {
            qc.setQueryData(key, muted);
            toast.success(muted ? "Conversation muted" : "Conversation unmuted");
          }
          setBusy(false);
        }}
      />
    </label>
  );
}
