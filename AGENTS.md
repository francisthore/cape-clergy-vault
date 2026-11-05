<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

# Project rules

- The active self-hosted workflow uses Better Auth, PostgreSQL/Drizzle RLS and private filesystem storage. Historical Lovable/Supabase interfaces are isolated read-only design references; do not reconnect them to the active workflow or remove Michael's attribution.
- Access enforcement belongs in RLS and narrowly scoped database functions. Verified approved clergy with current repository consent see their own submissions and accepted non-confidential repository resources. Confidential accepted resources remain private.
- Admin, clergy approver, settings manager and theological reviewer are separate capabilities. Admin does not imply reviewer or confidential-material access. Users may independently hold multiple legitimate capabilities; check the capability required for the action.
- Reviewer activation requires trusted exact-identity operator authorization, one-hour mailbox-bound proof and explicit authenticated acceptance. Invitations store only a token digest; durable delivery uses encrypted proof. Never print/log proof or infer authority from email matching. No real privileged grants run during migrations/startup.
- Review access requires live verified/approved/consented clergy and reviewer grants plus an active assignment to the exact current submission revision. No self-review, self-assignment or automatic access to amended revisions. Use app.can_review_submission, including in document audit authorization.
- Runtime cannot directly UPDATE submission status/metadata or INSERT review decisions. Author writes use existing draft/transition functions; review actions use app.decide_review to atomically update state/version, immutable history, lifecycle evidence, audit and notification intent. Do not broaden privileges to fix errors.
- Private reviewer notes remain separate from author-facing revision feedback. Authors receive only the safe feedback projection; never expose legacy review_decisions.notes through author/repository APIs or email.
- All document downloads use the authenticated Phase 3C private streaming service with live RLS and mandatory committed authorization/start audits before bytes. No public object URLs or anonymous downloads. Revocation cannot recall already-transferred bytes.
- Audit, consent, approval, review, reviewer-event and submission-event histories are append-only. Preserve existing evidence and applied migrations; use additive forward migrations and reviewed function grants.
- Notification intents commit with business actions; provider I/O follows commit through the common EmailService/dynamic PostgreSQL settings. Preserve leases, stable idempotency/payload snapshots and bounded retries. Use captured email and disposable accounts/PDFs for tests; never contact live Supabase/Resend in tests.
- Guarded operator/worker owner credentials stay outside web handlers. Protected requests derive identity only from live server-verified Better Auth cookies, never browser identity/role fields. Read docs/reviewer-operations.md before privileged maintenance.
- Only .env.example may be tracked. Preserve ignored private environments and the project-specific guarded local PostgreSQL cluster; never alter other apps/databases or deploy implicitly.
- Chat migration, Google OAuth, deployment and Phase 3F are excluded from Phase 3E. Legacy chat/outbox/PWA guarantees remain isolated: do not enable private-data service-worker caches or cross-account offline delivery.
- Preserve legacy PWA installation guarantees: vite-plugin-pwa generateSW, one guarded registration wrapper, no worker in preview/dev, OAuth/APIs excluded, and no cached private responses.
- Preserve isolated offline draft/outbox guarantees: user-scoped IndexedDB and stable message UUIDs; delivery revalidates the current account against live RLS, blocked retries are explicit, and sign-out clears local data.
- Deferred private chat must retain one owner-scoped stream, current notice consent and live reviewer authorization, with no client edits/deletions. Authenticated route query options and refresh checks remain required when that migration is separately authorized.
- Conversation mute preferences remain per-user RLS rows; any future push recipients must be filtered by live roles, consent and mute before delivery.
- Before release, retain the documented privacy/retention, quarantine/scanning, infrastructure/roles, shared rate-limit, monitoring, worker scheduling, deliverability, backups/restore, quota/capacity and browser/mobile/accessibility prerequisites. Do not claim unrestricted confidential readiness.
