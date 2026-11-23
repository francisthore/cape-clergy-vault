# Cape Clergy Vault V1 production readiness

**Release status, 23 November 2026 — hold real-clergy launch.** The target is a fully operational clergy service for approximately five daily users. The software has a local release candidate. Host isolation, peak capacity, live provider performance and responsible-party decisions still need evidence. No host change follows from the stakeholder decision to proceed.

## Application boundary

- V1 accepts up to **4,194,304 actual bytes per PDF**, including on chunked uploads. Clergy may attach several locally prepared, labelled parts to an editable document submission. Nginx accepts a 4m raw request body. The application, private storage, finalisation and scanner independently bound the file.
- Migration **0040_v1_confidential_scanning** adds an initially empty owner-managed decision register. A confidential upload records the active reference on its scan job. A new Bouncer claim must match that decision and reservation locks it again before quota consumption and transfer intent. Withdrawal blocks new reservations. A committed reservation may already be in flight.
- The reservation records immutable evidence specific to that document and scan correlation. A confidential Bouncer download needs this event, the decision reference and matching completed clean evidence. A new organisational decision cannot make an old verdict eligible. A known historical provider ID may finish polling. A submission without an ID after an uncertain transfer is held. Retain the two previously identified confidential provider IDs for restricted investigation.
- External intent freezes both directions of confidentiality change, including excluded attachments. A confidential result never causes publication. Current consent, author ownership or exact-revision independent reviewer authority, private storage and committed authorisation/start audits still govern access. The shared repository filters accepted non-confidential work before counts and pagination.
- An existing large file keeps its metadata, bytes and history. Inventory these files before cutover. New transfers over 4 MiB are ineligible. Resolve any pending oversized submission with its author and the responsible office, without resetting evidence or changing confidentiality.
- The acknowledged registration text remains versioned separately from the proposed notice. An approved notice/version and an explicit decision on existing users' acknowledgements are production dependencies. See the [privacy decision register](privacy-approval-register.md).

## Four services on the shared VPS

The Phase 5A inventory records Ubuntu 24.04, systemd 255, PostgreSQL 16, two vCPUs, approximately 3.8 GiB usable RAM and a single 2.5 GiB available-memory sample. Daily user count does not bound simultaneous scanner, mail, backup or database work.

| Service | Processes at peak including namespace launcher | Node old-space maximum | MemoryHigh / MemoryMax | CPUQuota | TasksMax |
| --- | ---: | ---: | ---: | ---: | ---: |
| Web | 2 | 256 MiB | 448 / 576 MiB | 75% | 48 |
| Scanner | 3 | 2 × 96 MiB | 224 / 320 MiB | 25% | 48 |
| Approval notifications | 3 | 2 × 96 MiB | 160 / 224 MiB | 15% | 48 |
| Reviewer notifications | 3 | 2 × 96 MiB | 160 / 224 MiB | 15% | 48 |
| Combined per-unit ceilings | 11 | 832 MiB | 992 / 1,344 MiB | 130% | 192 |

Four namespace launchers and four Node processes stay resident. Three batch children can coincide. Native allocations, thread stacks, streaming buffers and filesystem cache add to the 832 MiB old-space figure. PostgreSQL backends and Nginx consume additional resources outside the slice. The service logins allow two web, two scan and four notification connections. Budget maintenance connections separately.

The candidate V1 slice drop-in sets high/max to 1,024/1,280 MiB, 160 tasks, 130% of one CPU and zero swap. It can throttle or OOM before all individual maxima fit, with a 64 MiB aggregate shortfall. At the prior snapshot a 1,280 MiB slice would leave roughly 1.25 GiB available before additional database/host demand. At peak quota the slice could consume 1.3 of two vCPUs. IOWeight needs a working I/O controller. The base slice is for web-only staging. [V1 slice candidate](../ops/systemd/cape-vault-v1.slice.conf.example)

## Capacity decision

Capture peak-period baselines for all neighbours including any scheduled return of kbsk-staging. Require the Phase 5A full-service entry gate of at least 2.5 GiB available before load. Record PostgreSQL memory/connections, disk and inode headroom, swap, CPU and memory pressure, and neighbour response times. Repeat under all four units with all three batches active, a 4 MiB upload/scan/download, email bursts, and separately during backup/restore I/O. Record peak memory and task counts, CPU throttling, OOM/pids events, queue delays, lost requests and neighbour latency before/during/after.

An OOM, denied fork, start-limit failure, growing shared swap or neighbour regression stops the exercise. Keep the affected service private and restore baseline. Record the measured bottleneck and timestamps. If scheduling heavy work outside peak cannot meet the signed latency and queue budgets in a repeat test, move the service to a dedicated host or obtain additional capacity. Five daily users and the historical snapshot do not certify the VPS. [Host tests and abort criteria](phase-5a-host-acceptance-tests.md)

## Launch decisions

The release owner must attach the following evidence to the launch record.

- [ ] Named accountable service owner, Information Officer or delegated office, incident contacts, provider agreements, processing and transfer decisions, notice and acknowledgement rollout, and adopted retention/hold procedures.
- [ ] Verified host namespace, credentials, storage mounts, shutdown, restart and neighbour/capacity results. Dedicated checksum-verified Node 24 patch and working PostgreSQL 16 transport. Global Node 22 retained.
- [ ] Approved Bouncer and Resend synthetic windows, with named recipients, quotas, times, operator, stop conditions and actual results.
- [ ] Private four-service acceptance including independent reviewer activation, restart/lease recovery, browser/mobile/accessibility review, notification delivery and monitoring escalation.
- [ ] A recoverable coordinated backup, separate key custody, successful isolated restore, approved RPO/RTO, retention and an accountable on-call operator.
- [ ] Approved release archive digest, migration ledger and role audits, rollback owner and separate signed public-release decision.

Record outcomes in the [launch matrix](v1-launch-acceptance.md). Execute only the separately authorised stage in the [deployment runbook](v1-deployment-runbook.md).
