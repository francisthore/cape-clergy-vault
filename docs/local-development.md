# Local development — Phase 4.2.1

Use Node 24.12+, the existing dependencies, Bash, `flock`, and the existing marked
project PostgreSQL cluster. No production service or deployment is installed.

## One command

The reviewed launcher is `scripts/dev-all.sh`, backed by `scripts/dev-all.mjs`.
The originally supplied `scripts/cape-dev-all.sh` is preserved as a reference.

With Bouncer and real Resend already configured:

```sh
bun run dev:all --allow-live-email --allow-bouncer
```

With explicitly configured captured email and Bouncer:

```sh
bun run dev:all --allow-capture-email --allow-bouncer
```

With an existing local ClamAV socket and captured email:

```sh
bun run dev:all --allow-capture-email
```

Use flags matching your actual provider. The launcher never switches providers.
`--allow-live-email` authorizes queued real notification delivery **and** normal
web authentication email. `--allow-bouncer` authorizes transfers of queued PDFs,
including ones uploaded earlier. The first worker cycle runs immediately.
`--allow-capture-email` explicitly acknowledges that captured delivery completes
persistent queue intents: changing from Resend to capture loses real delivery for
those processed intents. Do not change a real queue's provider merely to run locally.

Append `--check` for configuration and port checks only. It does not start the
database, verify its live schema/roles, launch workers, or call providers. It still
requires the applicable opt-in flags, making the intended full command reviewable.

## Configuration boundaries

Existing private files are preserved and are parsed as data, never shell sourced:

| File                          | Process                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| `.env.db.local`               | Marked PostgreSQL startup only; owner URL never enters web/workers          |
| `.env.db.runtime.local`       | Web restricted runtime identity and private storage configuration           |
| `.env.db.scanner.local`       | Scanner identity, ClamAV socket or Bouncer key/upload host, private storage |
| `.env.db.notifications.local` | Both notification workers' restricted notification identity                 |
| `.env.auth.local`             | Web and notification workers' auth/email settings                           |

`BETTER_AUTH_URL` must be `http://localhost:3000` (or `http://127.0.0.1:3000`;
use that exact host in your browser). A secret of at least 32 characters is required.
Set `EMAIL_PROVIDER` explicitly to `resend` or `development`. Real delivery also
requires a key and `EMAIL_DOMAIN_VERIFIED=true`; existing live PostgreSQL sender,
domain authorization and enable checks still govern delivery. Web and scanner
must use the same `CAPE_STORAGE_ROOT` (default `.local/storage`). Each PDF is limited to 4 MiB. The small-file Bouncer route needs no S3 host.

Only allowlisted settings enter each child. Inherited `NODE_ENV`, `NODE_OPTIONS`,
provider keys and database URLs cannot override those files. In particular,
inherited test mode cannot silently capture a persistent Resend queue. Vite's
ordinary development env files are checked for worker credentials and secret-like
`VITE_` keys. Never put a secret in a `VITE_` variable. Only `.env.example` may be
tracked; captures and private storage remain ignored.

## Startup and shutdown

Startup refuses missing/invalid configuration, port 3000 conflicts, another
launcher, duplicate worker loops/batches, wrong database targets or privileges.
It starts only `db:local:start` against the marked existing project cluster. It
never initializes, resets, migrates, seeds, grants roles or deletes data. A
read-only preflight checks each restricted identity and the owner-status function.

Migration `0040_v1_confidential_scanning.sql` and the reviewed role grants are required. Review them
and use the established guarded migration procedure deliberately before running
this version against the persistent database. The launcher never applies it, and
the implementation/test session did not apply it to persistent development data.
Do not rerun role setup or broaden grants to fix a failed preflight.

The web server binds `127.0.0.1:3000` with strict port selection. One scanner loop,
one approval/registration-mail loop, and one reviewer-mail loop execute bounded
batches roughly every 60–65 seconds. Each completed cycle prints a safe JSON
summary. Per-job failures propagate a failed cycle without changing retry policy.
Three consecutive failed cycles stop the whole group with a nonzero exit.
A successful cycle resets the consecutive failure count. An empty queue does not
prove provider health; inspect backlog and delayed/exhausted jobs as well.

Ctrl+C or SIGTERM stops web and loops. An active batch gets up to 190 seconds to
finish; after 195 seconds the launcher kills remaining process groups. Durable
leases recover interrupted work; no retry counts, IDs or payload snapshots are
reset. PostgreSQL is left running, and all its data is retained. If you deliberately
want to stop it later, use `bun run db:local:stop` separately.

## Diagnosis

- Configuration failure: check the named private file/key locally. Never paste
  URLs, auth secrets, provider keys, invitation proofs or captured messages into logs.
- Port conflict: inspect `ss -ltnp 'sport = :3000'`; stop only the intended process.
  Vite does not silently select another port.
- Duplicate group/worker: stop the existing group with Ctrl+C. Locks release on
  process exit. Deleting a lock file while a process runs defeats coordination;
  do not delete `.local/dev-all.lock` or `.local/worker-*.lock` to force startup.
- Failed database preflight: inspect the marked cluster with `bun run db:status`;
  review migration status and dedicated role configuration. Do not reset the cluster.
- PDFs waiting: `bun run operations:report` and `bun run db:scans:usage` provide
  operator diagnostics. Check worker cycles, ClamAV/socket readiness or Bouncer
  capacity, quota/backoff and held jobs. Never mark a file clean manually.
- Mail waiting: `bun run db:notifications:status` reports queue counts. Check
  sender enable flags, domain authorization, leases, attempts and provider evidence.
  See [registration notifications](registration-notifications.md) and
  [reviewer operations](reviewer-operations.md) before privileged recovery.
- Repeated cycle failures: the process exits visibly; resolve the cause, then
  rerun the same explicitly authorized command. Held/exhausted jobs require
  deliberate investigation; an empty subsequent cycle does not repair them.

Individual one-shot commands remain available: `bun run db:scans`,
`bun run db:notifications`, and `bun run db:reviewer:notifications`. They share
session advisory locks with supervised batches. They are operational commands
against the configured queue, not automated tests.

## Tests

```sh
bun run test:dev
bun run test
bun run typecheck
bun run test:phase421
```

`test:dev` uses temporary configuration and process stubs, including graceful
shutdown, conflicting ports, duplicate locks and failed-cycle recovery. It never
connects to PostgreSQL or providers. It requires permission to bind loopback.

`test:phase421` uses the established isolated source-snapshot runner on port 55433,
leaving the preserved cluster on 55432 untouched. It builds from a sanitized copy,
creates fresh PostgreSQL roles/clusters, runs scanner/security and notification
checks, the owner-projection/worker-lock checks, then browser acceptance at four
viewport widths. Bouncer is mocked, email captured, and external browser/server
fetches blocked. Whole disposable clusters are removed after verifying their
identity; history rows and triggers are never bypassed. Do not substitute ordinary
`db:test:*` commands that load persistent env files for this isolated runner.
