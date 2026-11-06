# Real ClamAV operational acceptance

**Blocked in this environment.** Neither clamd nor FreshClam is installed; the default
Unix socket is absent and Docker API access is denied. No package installation,
container daemon change, VPS access or service restart was attempted. Protocol doubles,
TestScanner lifecycle tests and restore fixtures do not establish malware detection.
Confidential upload acceptance requires real-daemon evidence.

Use the [official support policy](https://docs.clamav.net/faq/faq-eol.html) to choose a
currently supported patched release and compatible FreshClam at provisioning time;
record version, source, signature version/build timestamp and configuration checksum.
Do not freeze a version from this document or use an unsupported distribution package.
See [official scanning guidance](https://docs.clamav.net/manual/Usage/Scanning.html)
and [daemon protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html).

## Proposed disposable configuration review

After separate installation authorization, provision an isolated daemon/signature
store with `TZ=UTC`, protected absolute Unix socket and non-world-accessible ancestors.
Record actual UID/GID and modes using `stat`; demonstrate worker access and denial
from an unrelated test UID. No daemon TCP listener. Use one compatible FreshClam
updater, verified supported signature sources and authenticated update/reload path.
Record available memory and loaded definition age before and after restart/update.
Measure daemon peak memory (including concurrent signature reload) and scan latency.

Review `clamconf -n` in a protected terminal. Proposed `StreamMaxLength 25M`,
`MaxFileSize 25M`, `MaxScanSize 200M` are starting values, **not attested safe limits**.
Allow the entire 20 MiB application payload plus applicable decompressed content;
exercise recursion/decompression limits and encrypted/uninspectable content.
Enable supported `AlertExceedsMax` and applicable encrypted-PDF alerts so inspection
limits cannot silently return clean. Bound threads/recursion against memory capacity.
Application deadlines are below lease expiry; bounded size/limits/errors never promote.
Do not lower application freshness or weaken daemon checks to get a passing test.

## Operator commands and expected evidence

Run only in a newly approved isolated environment; service/path names below are
proposals, never existing VPS instructions. Capture version/status/categories privately,
never private PDF names, socket secrets or document contents.

```sh
clamd --version
freshclam --version
clamconf -n
stat /PROPOSED/private-clamav/clamd.sock
# First configure isolated updater/daemon paths; avoid the host defaults.
freshclam --config-file=/PROPOSED/private-clamav/freshclam.conf
clamd --foreground --config-file=/PROPOSED/private-clamav/clamd.conf
# From another protected terminal, against that socket only:
CAPE_CLAMD_SOCKET=/PROPOSED/private-clamav/clamd.sock bun run test:scanner
bun run db:scans
bun run operations:report
```

Expected: supported engine; successful update and loaded fresh VERSION; protected
socket; scanner health ready; clean fixture promoted with exact-byte hash and immutable
scan event. The optional real-clamd test runs only when the configured socket exists;
a skipped test is not acceptance. Extend the supervised run with the following table,
recording expected and observed separately. The installed test alone does not cover
this entire daemon/configuration acceptance pack.

| Test/fault                                                 | Expected safety/recovery                                          | Observed here                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Harmless complete PDF                                      | clean exact-hash evidence; only then available                    | Protocol/lifecycle double passed; real Blocked                 |
| Standard harmless EICAR fixture, never live malware        | detected/infected; no download; retain evidence                   | Real Blocked                                                   |
| Daemon crash/offline                                       | error/quarantine; durable retry; restart then probe before resume | Simulated protocol/lifecycle only                              |
| Missing signature DB                                       | daemon/probe unavailable; no promotion                            | Simulated protocol only                                        |
| Stale definitions / update failure                         | stale verdict; no promotion; updater repair/load fresh database   | Simulated freshness only                                       |
| Socket permissions failure / unrelated user                | fail closed/denied; restore intended access only                  | Unsafe-socket protocol test only; OS cross-UID Blocked         |
| 20 MiB complete input / stream limit / decompression limit | full inspection or unavailable; never partial clean               | Protocol size tests only; real Blocked                         |
| Timeout / malformed / unknown reply                        | no promotion, bounded retry/category                              | Protocol passed                                                |
| Worker interruption / DB outage during result commit       | durable lease; no invented completion                             | DB lease/synthetic failure tests; real process kill Not tested |
| Stale lease / duplicate completion                         | current lease only, consistent immutable evidence                 | Restricted DB tests passed                                     |
| Missing private object / changed hash                      | fail closed; operator reconciliation                              | Lifecycle + isolated restore passed                            |
| Failed promotion / exhausted attempts                      | unavailable, retained evidence; investigate exact ID              | Lifecycle passed                                               |
| Restart/reload/timezone/RAM/signature refresh              | stable ready state with supported UTC version/freshness           | Not tested on a real daemon                                    |

For safe recovery: preserve objects/jobs/history; restore only the isolated dependency;
check VERSION freshness and negative/positive fixtures; let leases expire naturally;
resume bounded worker. Investigate exhausted jobs rather than resetting attempts.
No result may be marked clean because metadata, an operator assertion or an old scan
says so. The application cannot discover every silent daemon skip via INSTREAM;
configuration attestation and real limit fixtures are mandatory acceptance evidence.
Record date/operator/engine/config hash/signature timestamp, each test ID, expected vs
observed state, document/job correlation UUIDs and approval reference before lifting
this blocker. This document authorizes no installation.
