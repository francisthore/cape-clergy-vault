import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useAccount } from "@/lib/auth/account-context";
import { accountRequest } from "@/lib/auth/client";
import { Crest } from "./branding/Crest";

export function SiteHeader() {
  const account = useAccount();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checking = ["loading", "error"].includes(account.status);
  const guest = account.status === "signed-out";
  const linkClass =
    "block rounded px-3 py-2 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <header className="border-b border-border bg-card">
      <a
        className="skip-link"
        href="#main-content"
        onClick={() => {
          setOpen(false);
          requestAnimationFrame(() => {
            const main = document.querySelector("main");
            if (main) {
              main.id = "main-content";
              main.tabIndex = -1;
              main.focus();
            }
          });
        }}
      >
        Skip to main content
      </a>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-3" onClick={() => setOpen(false)}>
          <Crest size="header" />
          <span className="min-w-0 leading-tight">
            <span className="block font-serif text-lg font-semibold">TEFT Repository</span>
            <span className="block max-w-56 text-xs text-muted-foreground sm:max-w-none">
              Theological Education Formation and Training
            </span>
          </span>
        </Link>
        <button
          type="button"
          className={`${linkClass} border lg:hidden`}
          aria-expanded={open}
          aria-controls="site-navigation"
          onClick={() => setOpen(!open)}
        >
          Menu
        </button>
        <nav
          id="site-navigation"
          aria-label="Main navigation"
          className={`${open ? "flex" : "hidden"} w-full flex-col gap-1 text-sm lg:flex lg:w-auto lg:flex-row lg:flex-wrap lg:items-center`}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          <Link
            to="/"
            className={linkClass}
            activeProps={{ "aria-current": "page", className: "bg-secondary font-semibold" }}
          >
            Home
          </Link>
          {guest ? (
            <>
              <Link
                to="/auth"
                search={{ view: "login", token: "", error: "" }}
                className={linkClass}
                activeProps={{ "aria-current": "page", className: "bg-secondary font-semibold" }}
              >
                Sign in
              </Link>
              <Link
                to="/auth"
                search={{ view: "register", token: "", error: "" }}
                className={linkClass}
                activeProps={{ "aria-current": "page", className: "bg-secondary font-semibold" }}
              >
                Register
              </Link>
            </>
          ) : (
            !checking && (
              <>
                {account.canUseRepository && (
                  <>
                    <Link
                      to="/submissions"
                      className={linkClass}
                      activeProps={{
                        "aria-current": "page",
                        className: "bg-secondary font-semibold",
                      }}
                    >
                      My submissions
                    </Link>
                    <Link
                      to="/repository"
                      className={linkClass}
                      activeProps={{
                        "aria-current": "page",
                        className: "bg-secondary font-semibold",
                      }}
                    >
                      Repository
                    </Link>
                  </>
                )}
                {account.canApprove && (
                  <Link
                    to="/admin/registrations"
                    className={linkClass}
                    activeProps={{
                      "aria-current": "page",
                      className: "bg-secondary font-semibold",
                    }}
                  >
                    Manage registrations
                  </Link>
                )}
                {account.canReview && (
                  <Link
                    to="/reviewer"
                    className={linkClass}
                    activeProps={{
                      "aria-current": "page",
                      className: "bg-secondary font-semibold",
                    }}
                  >
                    Reviewer workspace
                  </Link>
                )}
                {account.canManageSettings && (
                  <Link
                    to="/admin/settings/email"
                    className={linkClass}
                    activeProps={{
                      "aria-current": "page",
                      className: "bg-secondary font-semibold",
                    }}
                  >
                    Email settings
                  </Link>
                )}
                <Link
                  to="/account"
                  className={linkClass}
                  activeProps={{ "aria-current": "page", className: "bg-secondary font-semibold" }}
                >
                  My account
                </Link>
                <button
                  type="button"
                  className={`${linkClass} text-left`}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await accountRequest("sign-out", {});
                      setOpen(false);
                      await router.navigate({
                        to: "/auth",
                        search: { view: "login", token: "", error: "" },
                      });
                    } catch {
                      setError("Sign-out failed. Please try again.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Signing out…" : "Sign out"}
                </button>
              </>
            )
          )}
          {checking && (
            <span className="px-3 py-2">
              {account.status === "error"
                ? "Account check unavailable. Refresh to retry."
                : "Checking account…"}
            </span>
          )}
          {error && <p role="alert">{error}</p>}
        </nav>
      </div>
    </header>
  );
}
