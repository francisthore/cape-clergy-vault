import { profileValues } from "@/lib/auth/registration";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ProfileFields, PrivacyAcknowledgement, Field } from "@/components/RegistrationFields";
import { accountRequest } from "@/lib/auth/client";

const views = ["register", "login", "verified", "resend", "forgot", "reset"] as const;
type View = (typeof views)[number];
export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: views.includes(search["view"] as View) ? (search["view"] as View) : ("login" as View),
    token: typeof search["token"] === "string" ? search["token"] : "",
    error: typeof search["error"] === "string" ? search["error"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Clergy account — Cape Clergy Vault" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: AuthPage,
});
function AuthPage() {
  const { view, token, error } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState(false);
  const [complete, setComplete] = useState(false);
  const titles: Record<View, string> = {
    register: "Clergy registration",
    login: "Welcome back",
    verified: "Email verification",
    resend: "Resend verification",
    forgot: "Forgot password",
    reset: "Set a new password",
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "");
    setBusy(true);
    setMessage("");
    setFailure(false);
    try {
      if (view === "login") {
        await accountRequest("sign-in/email", {
          email: value("email"),
          password: value("password"),
        });
        window.location.assign("/account");
      } else if (view === "register") {
        const response = await accountRequest("register", {
          ...profileValues(form),
          email: value("email"),
          password: value("password"),
          confirmPassword: value("confirmPassword"),
        });
        setMessage(response.message ?? "Check your email to verify your address.");
        setComplete(true);
      } else if (view === "resend" || view === "forgot") {
        const response = await accountRequest(
          view === "resend" ? "send-verification-email" : "request-password-reset",
          { email: value("email") },
        );
        setMessage(response.message!);
      } else if (view === "reset") {
        if (value("password") !== value("confirmPassword")) throw new Error("Passwords must match");
        await accountRequest("reset-password", { token, newPassword: value("password") });
        window.history.replaceState(null, "", "/auth?view=reset");
        setMessage("Your password has been reset. Sign in with your new password.");
        setComplete(true);
      }
    } catch (err) {
      setFailure(true);
      setMessage(err instanceof Error ? err.message : "Please try again");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-4xl font-semibold text-primary">{titles[view]}</h1>
      <p className="mt-3 text-muted-foreground">
        Anglican Diocese of Cape Town · Cape Clergy Vault
      </p>
      {view === "verified" ? (
        <div role="status" className="mt-6 rounded-lg border bg-card p-6">
          {error
            ? "This verification link is invalid, expired or already used. Request a new link below, or sign in if you have already verified your email."
            : "Your email address has been verified. Your registration is awaiting approval. You will be notified once your account has been approved."}
        </div>
      ) : (
        !complete && (
          <form
            onSubmit={submit}
            className="mt-8 space-y-4 rounded-lg border border-border bg-card p-6"
          >
            {view === "register" && <ProfileFields />}
            {view !== "reset" && (
              <Field
                name="email"
                label="Email address"
                type="email"
                autoComplete="email"
                maxLength={255}
              />
            )}
            {["register", "login", "reset"].includes(view) && (
              <Field
                name="password"
                label="Password"
                type="password"
                minLength={view === "login" ? 1 : 12}
                maxLength={128}
                autoComplete={view === "login" ? "current-password" : "new-password"}
              />
            )}
            {["register", "reset"].includes(view) && (
              <>
                <p className="text-sm text-muted-foreground">
                  Use 12–128 characters. A long, unique passphrase is suitable.
                </p>
                <Field
                  name="confirmPassword"
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                />
              </>
            )}
            {view === "register" && <PrivacyAcknowledgement />}
            {view === "reset" && (!token || error) && (
              <p role="alert">This reset link is invalid or expired. Request a new one.</p>
            )}
            <Button className="w-full" disabled={busy || (view === "reset" && (!token || !!error))}>
              {busy
                ? "Please wait…"
                : {
                    register: "Register",
                    login: "Sign in",
                    resend: "Send verification email",
                    forgot: "Send reset email",
                    reset: "Reset password",
                    verified: "Continue",
                  }[view]}
            </Button>
          </form>
        )
      )}
      {message && (
        <p className="mt-4" role={failure ? "alert" : "status"}>
          {message}
        </p>
      )}
      <nav
        aria-label="Account help"
        className="mt-6 flex flex-wrap gap-4 text-sm text-primary underline"
      >
        <a href="/auth?view=login">Sign in</a>
        <a href="/auth?view=register">Register</a>
        <a href="/auth?view=forgot">Forgot password</a>
        <a href="/auth?view=resend">Resend verification</a>
      </nav>
    </main>
  );
}
