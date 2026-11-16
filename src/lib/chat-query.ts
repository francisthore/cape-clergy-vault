import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { POPIA_VERSION } from "@/lib/popia";

export const chatQueryOptions = queryOptions({
  queryKey: ["chat"],
  refetchInterval: 5000,
  queryFn: async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) throw new Error("Please sign in again");
    const userId = auth.user.id;
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("popia_version, popia_accepted_at")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    const consented = profile?.popia_version === POPIA_VERSION && !!profile.popia_accepted_at;
    if (!consented) return { userId, consented, admin: false, messages: [], people: [] };
    const { data: admin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError) throw roleError;
    const { data: messages, error } = await supabase
      .from("chat_messages")
      .select("id, owner_id, sender_id, body, created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;
    const ownerIds = [...new Set((messages ?? []).map((message) => message.owner_id))];
    const { data: people, error: peopleError } = ownerIds.length
      ? await supabase.from("profiles").select("id, title, full_name, parish").in("id", ownerIds)
      : { data: [], error: null };
    if (peopleError) throw peopleError;
    return { userId, consented, admin: !!admin, messages: messages ?? [], people: people ?? [] };
  },
});
