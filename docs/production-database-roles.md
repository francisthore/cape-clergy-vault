# Database identity and capability design

All names here are project-specific proposals for production; guarded local setup
uses the same role names against only the marked development cluster. No remote
role creation or real application capability grant occurred.

| Identity                    | Allowed                                                                                                             | Denied                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `cape_clergy_runtime`       | Better Auth adapter CRUD; reviewed RLS reads/draft/transition/review/settings/audit functions; shared limiter       | Worker operations; outbox/proof reads; direct review/status writes; DDL; owner membership                                |
| `cape_clergy_scanner`       | `claim_document_scan`, `finish_document_scan`                                                                       | All direct app/auth table access; mail; capability grants; DDL/history mutation                                          |
| `cape_clergy_notifications` | `claim_notification`, `prepare_notification`, `check_notification`, `finish_notification`, `resolve_email_settings` | Every direct app/auth table read/write; scan jobs/documents; sender writes; role grants; decisions; DDL/history deletion |
| Migration/operator          | Explicitly authorized forward migrations, exact-ID maintenance and read-only operational reports                    | Normal web/background use; automatic privileged grants at startup                                                        |

Non-owner service logins have NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/
NOBYPASSRLS, no memberships, owned relations/schemas, database CREATE/TEMP, PUBLIC
schema creation or inherited privileged functions. RLS is enabled on all 25 app
tables. Auth tables retain their reviewed adapter boundary. Operator ownership can
bypass ordinary RLS; keep that credential outside services and record operator work.

## Provisioning boundary

`db:notifications:setup` validates the marked project data directory/endpoint/owner,
creates only the named local role, refuses unmarked identities or lost credentials,
checks unsafe attributes/memberships/ownership and applies `notifications-grants.sql`
transactionally. Generated `.env.db.notifications.local` is ignored and 0600.
Repeated setup preserves credentials. Runtime/scanner setup remains separate.
These scripts and the database-specific grant files **are local-only**. A production
operator must review a target-specific equivalent after infrastructure authorization,
including database CONNECT, no PUBLIC TEMP/CREATE, schema USAGE and exact function
signatures. Do not execute local scripts against a substituted URL.

Migration `0032_operational_boundaries` creates no LOGIN, passwords or privileged
application grants. Its fixed-search-path SECURITY DEFINER functions revoke PUBLIC
execution. Grants are reviewed in `database/notifications-grants.sql`; actual
`session_user` is checked, not client actor fields. The guarded local operator may
exercise these functions for fixture compatibility; services cannot adopt its role.
The named identity check and existing operator/scanner checks need explicit review
when choosing production names; do not add a broad owner-membership workaround.

## Outbox protocol

Claim locks one eligible row using SKIP LOCKED, increments attempts, commits a random
five-minute lease and returns only ID/kind. Preparation locks/rechecks that lease,
checks live eligibility, snapshots recipient/from/reply-to once, and returns only
that job's delivery material. Invitation ciphertext/digest and identity are supplied
only for that invitation; proof is decrypted inside the trusted delivery process.
No general identity/profile/document query is available to the worker.

Assignment checks reuse `app.assignment_notification_allowed` with the intent's
exact recipient/assignment/current revision and live reviewer authorization. Internal
actor settings are transaction-local and restored. The helper itself is not granted
to the worker. A second committed check runs immediately before provider I/O.
Completion/failure accepts only the same unexpired current lease. Cancellation,
expiration and replacement fence stale completions. Eight attempts, exponential
bounded retry, stable provider keys and sender/recipient snapshots survive restarts.
Changed mailbox cancels rather than silently retargeting a retry, now also for the
approval queue. Reviewer cancellation retains its immutable audit trigger; approval
cancellation writes ID-only audit. No decision changes follow a provider failure.

One email login serves both outboxes: shared provider/configuration, minimum function
surface and simpler rotation for a small installation. It can access claimed encrypted
invitation delivery material, so compromise affects both notification domains. Two
separate roles plus per-queue authorization would reduce that blast radius but require
separate credentials and function grants. The current choice is one narrowly scoped
identity, **not** a database owner; the acceptance procedure records this trade-off.
Separate worker processes may use that login, with reviewer key material omitted from
the approval process. A worker that can send legitimate email remains a trusted
component; function grants do not protect against its own provider credential abuse.

`db:test:phase4` uses actual login credentials to prove denials, disjoint claims,
crash lease recovery, retry exhaustion, payload stability and provider failure safety.
Previous 3E/3F operator fixtures continue to cover exact review/mailbox cancellation.
No owner-only fixture is represented as restricted-role authorization evidence.
