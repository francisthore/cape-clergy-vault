import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { verifyDean } from "@/lib/reviewer.functions";

export const Route = createFileRoute("/_authenticated/verify-reviewer")({
  head: () => ({
    meta: [
      { title: "Verify reviewer account — Theological Repository" },
      {
        name: "description",
        content: "Confirm the Dean's account before review access is granted.",
      },
      { property: "og:title", content: "Verify reviewer account — Theological Repository" },
      {
        property: "og:description",
        content: "Confirm the Dean's account before review access is granted.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Verify,
});

function Verify() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const verify = useServerFn(verifyDean);
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  const send = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
    toast.success("Code sent to your email");
  };
  const confirm = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" });
      if (error) throw error;
      await verify();
      toast.success("Verified — review access granted");
      navigate({ to: "/review" });
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Verification failed");
    }
    setBusy(false);
  };

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-3xl font-semibold text-primary">Verify reviewer account</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The review queue opens only for accounts authorised by the Diocese, after confirming a
        one-time code sent to <strong>{email}</strong>.
      </p>
      {!sent ? (
        <Button className="mt-6 w-full" disabled={busy || !email} onClick={send}>
          Email me a code
        </Button>
      ) : (
        <div className="mt-6 space-y-3">
          <Input
            inputMode="numeric"
            placeholder="Enter the code from the email"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button className="w-full" disabled={busy || code.trim().length < 6} onClick={confirm}>
            Verify
          </Button>
        </div>
      )}
    </main>
  );
}
