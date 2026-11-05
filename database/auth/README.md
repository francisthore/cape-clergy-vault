# Better Auth integration (Phase 3A)

The existing `createLocalAuth` factory is now used by
`src/lib/auth/service.server.ts`, lazily configured in `runtime.server.ts` and
mounted at the TanStack Start `/api/auth/$` GET/POST route. Password/session/reset
operations remain Better Auth **1.7.16**. The public handler allowlists operations,
validates registration fields, preserves Set-Cookie, hides JSON session tokens,
checks trusted origins, and enforces throttling. No server actions set cookies,
so a `tanstackStartCookies` server-action plugin is unnecessary here.

The adapter explicitly enables transactions for auth identities/accounts and
password-reset/session revocation. In this pinned release, database after hooks
are queued after the auth transaction; independent postgres.js application queries
do not join its Drizzle transaction. Signup therefore commits auth first, then
uses a scoped SECURITY DEFINER provisioner for an atomic pending profile/clergy
role/explicit draft consent/history group. Failed provisioning is recoverable after
verification and login through `/account`; missing approval always fails closed.

Better Auth's email-verification JWTs are not inherently single-use. The delivery
callback stores SHA-256 digests in `auth.verifications`. The HTTP verification gate
atomically consumes one digest before Better Auth validates the JWT and updates
verified state. Failure burns the link; resend is the recovery path. Reset tokens
remain entirely Better Auth-managed. Callback URLs are fixed by the server.

Only guarded local runtime connections are supported. The offline generator and
official `generated.ts` remain unchanged. No Google OAuth or account migration.
See [the complete implementation report](../../docs/phase-3a-report.md) and
[database operations](../../docs/database.md). The offline
schema generation command remains:

```sh
bun run db:auth:generate
bun run db:generate --name=describe_auth_change
bun run db:check
```

`generated.ts` remains the unmodified official CLI output. Its text keys, timestamp
columns, indexes and internal auth cascade FKs are preserved. The app profile FK
uses NO ACTION to retain application history. Generation uses deliberately unusable
lazy credentials; runtime schema validation stays enabled. Do not use the Better
Auth CLI migrator or Drizzle push against this database.
