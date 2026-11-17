import { useAccount } from "@/lib/auth/account-context";
export function AccountActions({ administration = false }: { administration?: boolean }) {
  const a = useAccount();
  if (["loading", "error"].includes(a.status))
    return (
      <p role="status">
        {a.status === "loading"
          ? "Checking your account…"
          : "Account check unavailable. Refresh to retry."}
      </p>
    );
  if (a.status === "signed-out")
    return (
      <div className="flex flex-wrap gap-3">
        <a
          className="account-action account-action-button account-action-primary"
          href="/auth?view=register"
        >
          Register as clergy
        </a>
        <a className="account-action account-action-button" href="/auth?view=login">
          Sign in to your account
        </a>
      </div>
    );
  const actions: [boolean | undefined, string, string, string][] = [
    [
      !administration && a.canUseRepository,
      "/submissions/new",
      "Create a submission",
      "Prepare and send your resource to TEFT.",
    ],
    [
      !administration && a.canUseRepository,
      "/repository",
      "Browse repository",
      "Discover accepted, non-confidential resources.",
    ],
    [
      !administration && a.canUseRepository,
      "/submissions",
      "View my submissions",
      "Follow your resources and feedback.",
    ],
    [
      a.canApprove,
      "/admin/registrations",
      "Manage clergy registrations",
      "Review and decide clergy registration applications.",
    ],
    [
      a.canCoordinate,
      "/admin/intake",
      "TEFT submission inbox",
      "Route submitted revisions to eligible reviewers.",
    ],
    [
      a.canReview,
      "/reviewer",
      "Reviewer workspace",
      "Review only your currently assigned revisions.",
    ],
    [
      a.canManageAccess,
      "/admin/access",
      "Manage delegated access",
      "Verify exact identities, invite reviewers and manage delegated capabilities.",
    ],
    [
      a.canManageSettings,
      "/admin/settings/email",
      "Email settings",
      "Manage the application sender and notification settings.",
    ],
    [
      !administration && !a.canUseRepository,
      "/account",
      "View registration status",
      "Check your account and any remaining registration steps.",
    ],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {actions
        .filter(([allowed]) => allowed)
        .map(([, href, title, description]) => (
          <a className="account-action" href={href} key={href}>
            <strong>{title}</strong>
            <span>{description}</span>
          </a>
        ))}
      {administration && !actions.some(([allowed]) => allowed) && (
        <p>No administration capability is currently authorized for this account.</p>
      )}
    </div>
  );
}
