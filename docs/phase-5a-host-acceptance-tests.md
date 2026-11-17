# Phase 5A — Host acceptance tests (DO NOT RUN without owner authorisation)

Prepared 17 November 2026 for the verified host (Ubuntu 24.04.4, kernel 6.8.0-147,
systemd 255, 2 vCPU, 3.8 GiB RAM, 3.8 GiB swap). **Nothing here has been run.** Every
result is an expectation, not evidence. A test passes only when its _negative control_
fails as predicted; a test that cannot fail proves nothing.

Rules for the operator: synthetic markers only (`SYNTHETIC-PROBE-<random>`), no Cape Vault
secrets, no database, no network egress, no email, no Bouncer. Probe units use the
prefix `cape-probe-` and live only under `/run` (volatile). Abort and roll back
(section 8) on the first unexpected result. Keep a secret-free operator log.

Abort gates before any probe: `MemAvailable` ≥ 1.5 GiB, PSI memory `some avg60` < 5 %,
swap-in rate ≈ 0 (`vmstat 1 5`, `si`/`so` columns), all five neighbours `active`.

## 0. Read-only preconditions (no sudo)

| ID  | Command (names/versions only)                                                                                            | Pass criterion                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `uname -m; systemd-detect-virt; stat -fc %T /sys/fs/cgroup; cat /sys/fs/cgroup/cgroup.controllers`                       | Architecture matches the artifact (x86_64 assumed). `kvm`/full VM (not `lxc`/`openvz`). `cgroup2fs`; `cpu memory pids io` listed. |
| P2  | `cat /proc/sys/user/max_pid_namespaces /proc/sys/user/max_mnt_namespaces`                                                | Both > 0                                                                                                                          |
| P3  | `command -v unshare setpriv flock mount; unshare --version; setpriv --version`                                           | All present under `/usr/bin` (`mount` under `/usr/bin` or `/bin`); util-linux ≥ 2.39                                              |
| P4  | `sysctl kernel.yama.ptrace_scope fs.protected_hardlinks fs.protected_symlinks kernel.dmesg_restrict`                     | Recorded (informational; not relied upon)                                                                                         |
| P5  | `systemctl is-active systemd-oomd; systemctl is-system-running`                                                          | Recorded. If oomd is active it may kill by pressure: record for E-tests                                                           |
| P6  | `systemd-analyze --version \| head -1; systemd-analyze verify` of the rendered units copied to a scratch `.service` name | No _unknown key_ for any directive used                                                                                           |
| P7  | `aa-status 2>&1 \| head -5` (read-only; may need sudo: ask)                                                              | Recorded; no profile confining `unshare`, `setpriv`, `mount` for root                                                             |

## 1. Probe harness (requires explicit approval for each privileged step)

Create, as root, a scratch tree `/run/cape-probe/` (root 0700) containing:

- `libexec/launch` — a copy of `ops/libexec/cape-vault-ns-launch.example` with `NODE=` replaced
  by `/run/cape-probe/payload.sh` and the final `-- "$NODE" scripts/service-entry.mjs "$kind"`
  line changed to `-- "$NODE" "$kind"`. This is the **only** edit; diff it against the template
  and record the diff.
- `payload.sh` (root 0755), a read-only reporter that prints `id`, `NSpid`, `CapInh/Prm/Eff/Bnd/Amb`,
  `NoNewPrivs`, `Seccomp`, numeric entries of `/proc`, the `/proc` line of `/proc/self/mountinfo`,
  and the result (`OK`/`errno`) of the access attempts requested by the test. It writes nothing
  except to stdout (journal). Review it before use.
- `secrets/probe-secret` (root 0600) containing a synthetic marker, standing in for
  `/etc/cape-vault/secrets`.
- `objects/` standing in for storage (owned by the probe UID, 0700; see section 3).

Probe units `/run/systemd/system/cape-probe-{a,b}.service` copy the **real** web unit's
sandbox block verbatim (so the test exercises the production directives), changing only
`ExecStart=!/run/cape-probe/libexec/launch nobody <name>`, `User=nobody`, `Slice=cape-probe.slice`,
the three path directives (`InaccessiblePaths=/run/cape-probe/secrets`, etc.) and removing
`EnvironmentFile=`/`LoadCredential=` unless the test needs a synthetic credential
(`LoadCredential=probe:/run/cape-probe/secrets/probe-secret`).
`cape-probe.slice` carries reduced limits (MemoryMax=128M, CPUQuota=25 %, TasksMax=48).
`systemctl daemon-reload` is the only manager-wide action; it does not restart anything.
Two units on UID `nobody` model the shared web/scanner UID. If `nobody` owns anything on
the host (check `find / -xdev -user nobody` is **not** needed: use `systemd-run`'s
`DynamicUser=` only if the owner objects to `nobody`), pick another unprivileged probe UID the owner approves.

## 2. Namespace and process isolation

| ID  | Test                                                                                                                                                                                                        | Expected                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | `systemctl start cape-probe-a`; read its journal                                                                                                                                                            | Payload reports `pid=1`, uid ≠ 0, `/proc` numeric entries exactly `1`; mountinfo shows `proc … hidepid=invisible,subset=pid`; no `/proc/sys`.                                                                                                                                             |
| N2  | Same journal: capability and flag lines                                                                                                                                                                     | All five `Cap*` are all-zero; `NoNewPrivs: 1`; `Seccomp: 2` (RestrictNamespaces filter active).                                                                                                                                                                                           |
| N3  | In payload: `unshare -p true`, `unshare -m true`, `mount -t tmpfs x /mnt`, `setpriv --reuid=0 true`, `chown`, `ping`/raw socket                                                                             | Every attempt fails with EPERM/EACCES (no regained privilege; no further namespace).                                                                                                                                                                                                      |
| N4  | Start A (secret in its **environment** via `Environment=PROBE=SYNTHETIC-PROBE-1`) and B (same UID, same slice). From B read `/proc/<A host PID>/{environ,root,cwd,mem}`, `kill -0 <A host PID>`, `ls /proc` | ENOENT/ESRCH for every path; B lists only its own PID. A host PID is supplied by the operator from `systemctl show -p MainPID` (the outer `unshare` PID) and `/sys/fs/cgroup/.../cgroup.procs`.                                                                                           |
| N5  | **Negative control** (mandatory): copy A and B as `cape-probe-a0/b0` _without_ the launcher (`ExecStart=` runs the payload directly, same UID, `ProtectProc=invisible`)                                     | B **can** read A's `environ` and `/proc/<pid>/root/`. This proves the test would detect missing PID isolation, and proves `ProtectProc=invisible` alone is not sufficient for the shared storage UID.                                                                                     |
| N6  | Start the real `service-entry` path with a deliberately broken launcher (stage-2 copy lacking `--bounding-set=-all`, then lacking `unshare`) using dummy env only                                           | `service-entry.mjs` exits non-zero with the guard message **before** reading any credential; no execve; unit restart-limited. (Local unit tests prove the parser; this proves the wiring.)                                                                                                |
| N7  | `node -e` with the pinned Node 24: `typeof process.execve`, then `process.execve` to a script printing `process.pid`                                                                                        | `function`; PID remains `1` after exec. (If the experimental API is absent or behaves differently: stop.)                                                                                                                                                                                 |
| N8  | Graceful stop: payload traps SIGTERM and sleeps 20 s then exits 0. `systemctl stop cape-probe-a`; time it; then `systemctl kill -s SIGKILL`                                                                 | Stop takes ≈ 20 s, exit 0, **no** SIGKILL, cgroup empty afterwards, no orphan `unshare`. If the payload is killed immediately, `--kill-child=SIGTERM` forwarding failed: switch to `KillMode=control-group` and retest, then record that drain relies on SIGTERM reaching PID 1 directly. |
| N9  | Crash and restart: `kill -9` the namespace's PID 1 from the host; observe `Restart=`; repeat three times inside 300 s                                                                                       | Unit restarts (Restart=on-failure) with a **new** namespace; after the third, `StartLimitBurst` stops it; neighbours untouched.                                                                                                                                                           |
| N10 | After `systemctl restart` and (separately authorised) host reboot: re-run N1–N4                                                                                                                             | Unchanged. Probe units under `/run` vanish on reboot; real units re-run N1–N4 after install.                                                                                                                                                                                              |

## 3. Storage access

Run first with the probe objects tree, then repeat against `/var/lib/cape-vault/objects`
with the real units (still stopped to the network, synthetic marker file only).

| ID  | Test                                                                                                                                                        | Expected                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Web probe (`ReadWritePaths=`): create dir 0700 and file 0600, `stat` uid/mode, fsync, rename, unlink                                                        | Succeeds; `stat` shows storage UID and exact modes (the app's ownership checks require these); umask 0077 honoured.                                                      |
| S2  | Scanner probe (`ReadOnlyPaths=`): read the S1 file, then `touch`, `mkdir`, `rm`, `rename`, `chmod`, `truncate`; inspect `grep objects /proc/self/mountinfo` | Reads succeed; every mutation fails `EROFS`; mount shows `ro`. Repeat with the real scanner unit, which also runs the storage adapter's read-only rejection (app-level). |
| S3  | Approval/reviewer probes (different UID, `InaccessiblePaths=`): `ls`, `stat`, `cat` of objects path                                                         | ENOENT/EACCES. Tested with the objects path both present and owned by storage UID.                                                                                       |
| S4  | As each neighbour's service user (names from the owner, via `sudo -u <user>`): `ls -ld /var/lib/cape-vault /var/lib/cape-vault/objects; cat <S1 file>`      | EACCES. Parent directory root-owned 0711 or tighter; no neighbour is in group `cape-vault-*`; `id <neighbour>` shows no extra membership.                                |
| S5  | `namei -l /var/lib/cape-vault/objects`; check no symlinks, no world/group write on any ancestor; `getfacl -R` shows no ACL entries                          | Clean. Any default ACL or group access is a stop condition (breaks UID/0700 invariants).                                                                                 |
| S6  | Disk guard: `df` / `df -i` of the objects filesystem before and after; confirm it is the same filesystem class as neighbours                                | Recorded; no shared quota surprises. (No quota is enforced by templates: see capacity prerequisites.)                                                                    |

## 4. Credentials and secrets

| ID  | Test                                                                                                                                                                                                                                         | Expected                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **Stage-1 root retains the sandbox**: in the root launcher (before the drop) attempt `cat /run/cape-probe/secrets/probe-secret` and `ls /run/credentials/cape-probe-b.service`                                                               | Both fail (ENOENT/EACCES): proves `!` keeps `InaccessiblePaths` for root. **Negative control**: change `!` to `+`: the same read **succeeds** (this is exactly why `+` is forbidden).       |
| C2  | In A: `echo $CREDENTIALS_DIRECTORY; ls -ln` of it; `stat` file mode/uid. In B: open A's credential directory by its real path and by `/proc/<…>/root`                                                                                        | A sees only its own directory, files 0400 owned by the service UID, no symlinks (service-entry requires `(mode & 077)==0`). B: ENOENT.                                                      |
| C3  | `/etc/cape-vault/secrets` and the other units' `/run/credentials/cape-vault-*.service` from each real unit (once installed)                                                                                                                  | EACCES/ENOENT for every unit, including the operator mount path.                                                                                                                            |
| C4  | Secrets never in argv/env/log: after the real web start, from the host only: `systemctl show cape-vault-web -p Environment` and `journalctl -u cape-vault-web \| grep -c <synthetic marker>`; never read `/proc/*/environ` of a real service | No credential value or `*_API_KEY`/`*_DATABASE_URL`/`BETTER_AUTH_SECRET` variable at manager level; 0 journal hits. Credentials exist only as files under the unit's credentials directory. |
| C5  | Web receives `auth-secret` and `database-password` only; scanner `database-password` and `bouncer-key` only (key absent in synthetic staging); approval `database-password` only; reviewer `database-password` and `auth-secret`             | `ls` of each credentials directory matches exactly. Email drop-ins are **not** installed.                                                                                                   |
| C6  | Operator credential (`/run/credentials/cape-vault-operator.service`) appears only for the maintenance command and is gone afterwards                                                                                                         | Absent before and after; no service started while present.                                                                                                                                  |

## 5. Memory, CPU and task limits

Run only against `cape-probe.slice` with scaled-down limits and only while every abort
gate holds. Never test against the real slice by exhausting memory.

| ID  | Test                                                                                                                                                                                                      | Expected                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `cat /sys/fs/cgroup/cape-probe.slice/cgroup.subtree_control` and the unit's `memory.max/high`, `memory.swap.max`, `cpu.max`, `pids.max`, `io.weight`; `systemctl show -p OOMScoreAdjust`                  | Controllers enabled and values equal the unit (a missing controller means limits are silently absent: stop). `memory.swap.max` is 0.                                                                                                            |
| M2  | Probe allocates memory (`node -e` Buffer loop) beyond 128 M                                                                                                                                               | `memory.events` shows `high` throttling then `oom_kill ≥ 1` **only** in the probe cgroup; the host log `journalctl -k \| grep -i oom` names only `cape-probe`; no neighbour unit restarts (compare `NRestarts`, `MainPID`); swap use unchanged. |
| M3  | Probe CPU busy loop under `CPUQuota=25%`                                                                                                                                                                  | `cpu.stat` `nr_throttled` > 0; measured ≈ 25 % of one CPU; neighbours' own health-check latency (owner-nominated URLs) within 10 % of the pre-test baseline.                                                                                    |
| M4  | Probe spawns worker threads/processes until failure under `TasksMax=48`                                                                                                                                   | `EAGAIN` at ≈ 48 tasks in the probe only; `pids.events max` increments; neighbours unaffected. (Counts threads, so records the real thread count per Node process.)                                                                             |
| M5  | `oom_score_adj` of a probe process from the host                                                                                                                                                          | 500; the neighbours' values are unchanged (read-only comparison).                                                                                                                                                                               |
| M6  | If `systemd-oomd` is active (P5): rerun M2 and record whether oomd, not the kernel, killed the process and whether it considers neighbours                                                                | Recorded. Do not alter oomd configuration.                                                                                                                                                                                                      |
| M7  | **Real web, 24–48 h**, synthetic traffic only: `MemoryCurrent`, `MemoryPeak`, `memory.events` (`high`, `max`, `oom_kill`), threads (`ls /proc/<pid>/task`), `Slice` totals, host `MemAvailable`/PSI, swap | `high` stays 0; peak RSS < 80 % of `MemoryHigh`; host `MemAvailable` stays ≥ the tier gate; no neighbour regression. If `high` > 0, raise limits only by owner decision from measured data.                                                     |
| M8  | Process inventory: `systemd-cgls /cape-vault.slice`; `ps -eo pid,ppid,nlwp,rss,comm --sort=-rss` filtered by the slice cgroup                                                                             | Web: outer `unshare` + one Node. Record RSS and `nlwp` of each; compare with the budget in the assessment §6.                                                                                                                                   |

## 6. Neighbour regression checks (before, during, after each section)

For `makoti-production`, `onestop-kitchen-production`, `qahead-web`, `qahead-email-worker`,
`qahead-notification-worker` (and confirm `kbsk-staging` remains stopped): `systemctl is-active`
or the existing process-manager status table (`pm2 status` only; never `pm2 env/describe/jlist`),
`NRestarts`/uptime, listening ports, health endpoints chosen by the owner, error-log growth, the
host's `MemAvailable`, swap use and load. Any change attributable to our work ends the session.

## 7. Evidence and decision

Record for each ID: time, operator, exact command, output (secret-free), pass/fail, and the
negative-control result. **GO for the next phase only if every N, S, C and M1–M5 test passes, N5 and
the `+` control (C1) fail as predicted, and section 6 is clean.** A partial pass keeps staging
blocked; no sandbox directive is relaxed to obtain a pass.

## 8. Rollback if host acceptance fails (reverse order, remove only what we created)

0. **Stop** testing. Do not reboot, restart shared services, edit PM2, reload Nginx or change
   PostgreSQL. Record what ran and the observed state.
1. `systemctl stop 'cape-probe-*.service' 'cape-vault-*.service'`, then `systemctl stop cape-probe.slice cape-vault.slice`;
   confirm `cat /sys/fs/cgroup/cape-probe.slice/cgroup.procs` is empty (otherwise `systemctl kill -s SIGKILL` the unit,
   never `kill` a PID you cannot attribute to our cgroup).
2. Remove `/run/systemd/system/cape-probe-*.service`, `cape-probe.slice`, then `rm -r /run/cape-probe`
   (after `ls -lR` shows only our probe files). `systemctl daemon-reload`; `systemctl reset-failed 'cape-probe-*'`.
3. If real units were installed: remove only `/etc/systemd/system/cape-vault*` files and drop-in directories we added;
   `daemon-reload`; `reset-failed 'cape-vault-*'`; `systemctl list-unit-files | grep -i cape` must be empty.
4. Remove `/opt/cape-vault/libexec` and the pinned Node directory we extracted (`/opt/cape-vault/runtime/node-v24.*`), then
   `/opt/cape-vault` if empty. `/usr/bin/node`, `/usr/lib/node_modules` and other applications' runtimes are never touched.
5. Database/`pg_hba`/users/directories are removed only if created, following Phase 5B steps 5B-5 and 5B-4 rollback,
   and only after `ls -A` proves the synthetic directories are empty or contain only synthetic markers.
6. Compare against the Phase 5B-3 baseline (processes, ports, units, `MemAvailable`, swap, `nginx -t`, `pg_hba` checksum);
   record any residual difference and keep the application **unexposed** until explained.

**What a failure means** (in order of preference; each needs an explicit owner decision and, where code changes,
a new review — none is pre-approved):

| Failed area                                           | Response                                                                                                                                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!` does not preserve the mount sandbox (C1)          | Do not use the launcher. Evaluate a root-owned, reviewed launcher that applies the same `InaccessiblePaths`/`ReadOnlyPaths` itself (`unshare --mount` plus explicit `mount --bind`/`remount,ro`), or move to a host with systemd ≥ 257. |
| Launcher cannot create PID/mount namespaces (N1)      | Likely a container-class VPS or policy block. Host unsuitable for scanner co-location; consider a different VM. Do not run web + scanner as the same UID without PID isolation.                                                         |
| Stop is not graceful (N8)                             | Switch to `KillMode=control-group` and test; if the 190 s drain cannot be shown, keep mail/scanner loops off and restrict staging to web.                                                                                               |
| Memory/CPU enforcement absent or neighbours disturbed | Keep Tier 0 smaller or stop; never trade neighbour stability for our margin. Reconsider hosting on a separate VM.                                                                                                                       |
| Only web-only isolation (no PID ns possible)          | Possible only as a time-boxed web-only synthetic preview **if** the owner accepts it and a reviewed change to `service-entry.mjs` is approved (it currently requires PID 1). Scanner and mail stay disabled. No real data.              |
