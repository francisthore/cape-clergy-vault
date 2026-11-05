# Better Auth database foundation (inactive)

Better Auth, `@better-auth/drizzle-adapter`, and the official `auth` CLI are pinned
to **1.7.16**. Drizzle ORM 0.45.4 and Kit 0.31.11 satisfy their peer requirements.
The selected versions are stable; the newer 1.7.17 was excluded by the package
release-age safeguard. The Bun lockfile pins transitive dependencies.

`generated.ts` is the unmodified official CLI output, including its relation names,
text IDs, timestamp types, cascade FKs inside auth, constraints and indexes.
`generate.server.ts` supplies offline adapter metadata with `schemaName: "auth"`;
its deliberately unusable lazy PostgreSQL URL ignores environment credentials.
Schema validation is disabled **only for that offline generator** because it has
no existing table metadata. Runtime schema validation remains enabled.

```sh
bun run db:auth:generate
bun run db:generate --name=describe_auth_change
bun run db:check
# Review SQL, then guarded db:migrate; never auth migrate or drizzle-kit push.
```

`options.server.ts` shares naming/session/password options. `config.server.ts`
requires the guarded runtime connection, an explicit secret, base URL and real
verification-mail callback. It exports a factory, never a handler or singleton.
No application route imports it. Email/password requires verification; sessions
are database-backed with cookie caching disabled. No OAuth provider is configured.
The mail callback in tests captures verification tokens locally without sending mail.

`app.clergy_profiles.user_id` references `auth.users.id` with NO ACTION. This blocks
hard deletion of auth users with profiles and retains application/history records.
The auth library's own account/session cascades remain unchanged. Auth users may
exist without profiles; RLS denies protected content in that case. Profile
provisioning, approval, live account-disable/session revocation, reviewer mailbox
challenges and application integration remain Phase 3 work. Authentication never
implies application approval or reviewer privileges.

See [database operations and trust limitations](../../docs/database.md).

References: [official generator](https://better-auth.com/docs/concepts/cli),
[official Drizzle adapter](https://better-auth.com/docs/adapters/drizzle).
