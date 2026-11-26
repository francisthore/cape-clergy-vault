# Phase 5A acceptance evidence register · 26 November 2026

Index only. It restates records already in this repository and operator reports supplied on 26 November 2026. It changes no acceptance criterion and approves nothing. **Host acceptance and staging stay blocked.** "Operator-reported" means the source host evidence is not held in this repository and was not inspected for this register.

## Case 004 (C1 workflow) · operator-reported

| Item | Value |
| --- | --- |
| Source revision | `46dc4c53b81a0427d0f392e2685981aac9fef86c` (the later commit `467b7ac` differs only in docs and local tests; the reviewed unit sources are pinned to `60dba2c`) |
| SHA256SUMS digest | `49ca4fc5aded6f29c44a412981743755417e128d90ebcb3802506ce2d98f330a` (not independently rebuilt here) |
| Manager | systemd 255.4-1ubuntu8.19 |
| Setup / Bang / Runtime | PASS / PASS / PASS |
| Plus sibling control | **INCONCLUSIVE** (source read and ctl write succeeded; decoy credential hidden; plus exit 1 as the assessor expects) |
| Rollback | PASS. `workflow_rc=1`, `rollback_rc=0` |
| Neighbours / mounts | PM2 and Nginx unchanged; original mount fingerprint restored |
| Host evidence directory | `/root/cape-c1-004/evidence/` on the source host. **Not available locally; not inspected.** |

Cases 001–003 failed during setup and were rolled back. They are **not** security results and are not counted as passes or failures of any control.

## Status by group

| Status | Items | Basis |
| --- | --- | --- |
| **Already verified** (operator-reported, current revision) | C1a: `!` applies the mask to the source, keeps ctl read-only (EROFS), plus can write; runtime exceptions for scanner, approval and reviewer; own-credential listing; rollback and neighbour protection for Case 004 | Case 004 |
| **Earlier revision, carry-forward undecided** | G0, G1, G1b (26 Nov first run); N8 at 20 s and N8b at 40 s (26 Nov, `KillMode=control-group`); N1–N5 with negative controls (25 Nov) | Passed on unit files **before** the `/run` read-only rule (`60dba2c`). N1–N5 predate the KillMode change as well |
| **Inconclusive** | C1 plus sibling-credential control; C1b mask attribution | Plus hid the decoy with no mask in force; bang denial is real but its cause is unattributed |
| **Not run** | N7, N9, C2, C2c, C7, S1–S3, S3c, A1–A3, M1–M5, I1–I2 (formal probe), X1 (as a full-session check) | No report |
| **Deferred to 5B (unchanged)** | N6, N10, S4–S6, C3–C6, M7–M8, real-unit repeats | Host acceptance §10 |
| **Missing evidence** | See decision sheet section E | |

## Reconciled repository facts (checked locally)

| Fact | Result |
| --- | --- |
| Forward migrations in `database/migrations/` | 41 (0000–0040), plus journal in `meta/` |
| Migration 0039 SHA-256 | `38f19e2fca2d22fb8aead72b699697c90b287df8d0133ad8bd6d3f7e2f487819` |
| Migration 0040 SHA-256 | `0bb7ff79e2fdcf86cd94f12e342814c37987226b75500626ac88ad13ec1fdbaa` |
| Application tables with RLS | 30 (34 tables created; the other four are Better Auth) |
| Stale figures corrected or labelled | "40 migrations / 29 tables" in `release-readiness.md` and the 5B plan. The runbook and launch acceptance already said 41 and 30 |
| `npm run db:check` | Passes, but it checks `drizzle/`, not `database/migrations/`. It does not verify the 41-file count |
| Local checks run | `ops/host-probe/check-local.sh`, `ops/host-probe/c1/check-local.sh`, `npm run test:namespace-guard` (8/8), `git diff --check` all pass |

Persistent-database state (whether 0039/0040 are applied anywhere) was not re-inspected.
