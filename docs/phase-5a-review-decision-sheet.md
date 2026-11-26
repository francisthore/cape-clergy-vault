# Phase 5A review decision sheet · 26 November 2026

Blank by design. Nothing here is pre-approved. A reviewer who is neither the operator nor the author of the workflow completes it. Operator or author self-approval does not satisfy any row. Evidence status is in the [evidence register](phase-5a-evidence-register.md).

| Field | Entry |
| --- | --- |
| Reviewer name | |
| Reviewer role / independence statement | |
| Date (UTC or SAST) | |
| Bundle digest reviewed | |

## A. C1b Path P residual risk

Options (see [C1b paths](phase-5a-c1-host-verification.md)): **Path S** (paired `bang-nomask` run, not implemented or scheduled), **Path P** (accept as residual risk, never "proven"), or leave C1b open.

Evidence on file for Path P (operator-reported unless noted): package exactly 255.4-1ubuntu8.19; decoy passed its positive self-read; bang passed unchanged; plus read the source and wrote ctl but could not see the decoy; separate per-unit credential mounts; rollback passed. **Partial:** credential-parent contents were never listed, so projection is not conclusively established. **Unproven:** that the explicit mask caused the denial.

| Decision | Choice (Path S / Path P / keep open) | Limitations accepted (list) | Reviewer | Date |
| --- | --- | --- | --- | --- |
| | | | | |

If Path P: record whether a read-only listing of `/run/credentials` is required before sign-off (requirement 5). Production `-/run/credentials/<sibling>` lines stay. Acceptance-criteria change for the plus sibling row is a separate decision: approve / decline.

## B. Carry-forward of N1–N5

Passed 25 Nov on revision 4 files before the `/run` read-only rule and before `KillMode=control-group`. The six probe units that changed are the ones N1–N5 used.

| Decision | Choice (accept carry-forward / re-run on current files) | Rationale | Reviewer | Date |
| --- | --- | --- | --- | --- |
| | | | | |

## C. Carry-forward of N8 / N8b

Passed 26 Nov (20 s / 40 s) with `KillMode=control-group`, before the `/run` rule. The `/run` rule does not touch stop semantics, but that reasoning is the reviewer's to accept.

| Decision | Choice | Rationale | Reviewer | Date |
| --- | --- | --- | --- | --- |
| | | | | |

## D. Written I/O residual risk (I1–I2)

`system.slice` has no `io` controller (verified earlier), so `IOWeight=20` is inert. Host acceptance requires acceptance or rejection **in writing**. Options in the acceptance document: accept for about five users, or move to a separate VM. Remove any `IOWeight=` protection claim either way.

| Decision | Choice (accept / reject) | Conditions | Reviewer | Date |
| --- | --- | --- | --- | --- |
| | | | | |

## E. Missing evidence to collect

1. Case 004 evidence directory contents (reviewer to inspect on the source host or receive a safe copy): verifier output, per-phase logs, PM2 before/after, mount fingerprints, bang and plus reporters.
2. Independent rebuild of the bundle and comparison with `49ca4fc5…330a`, communicated outside the bundle.
3. Package-database record of `systemd 255.4-1ubuntu8.19` from the host (operator-reported only so far).
4. Credential-parent listing, if Path P requirement 5 is demanded.
5. Final PM2 and neighbour record tied to Case 004 (reported unchanged; retained file not seen).
6. Fresh G0 if G2 files are reinstalled, since the prior install was rolled back.
7. Anything the reviewer needs for B–D.

## F. Recorded decision

| Row | Decision | Reviewer identity | Date | Evidence reference |
| --- | --- | --- | --- | --- |
| A | | | | |
| B | | | | |
| C | | | | |
| D | | | | |
| Remaining-test plan (below) approved | | | | |

## Proposed minimum remaining G2 set (subject to reviewer approval; criteria unchanged)

Bounded to what gates a GO under host acceptance §10 and is not already evidenced. Each requires its own authorisation, a fresh G0 and P7, the existing rollback and neighbour checks (units, PM2, listeners, mounts, `kbsk-staging` on `*:3000`), and stop at the first mismatch.

| Order | Tests | Reason |
| --- | --- | --- |
| 0 | Decisions A–D above | Gates everything |
| 1 | N1–N5 re-run **only if** B requires it; N8/N8b only if C requires it | Revision currency |
| 2 | N7, N9 | Required for GO; not run |
| 3 | C2 with C2c, C7 | Required; not run. C2c needs the decoy readable for same-UID peer, so treat an inconclusive result as C1b-style attribution |
| 4 | S1, S2, S3 with S3c | Required; S1 also validates the web writable object-store exception that Case 004 did not cover |
| 5 | A1–A3 | Required; read-mostly |
| 6 | Path S pair, **only if** A selects it | Not scheduled |
| Later gate (G3) | M1–M5, I1–I2 recording, X1 | Stress and capacity; separate approval; I3 stays excluded |

## Unresolved blockers

- C1b open with no recorded reviewer decision.
- Case 004 evidence not available to review locally.
- No independent reviewer identified in the repository.
- Staging, deployment and Phase 5B remain NO-GO.
