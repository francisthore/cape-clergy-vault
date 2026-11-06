# Privacy and retention readiness

This is a technical inventory and decision register for a pre-launch local application.
The draft notice and these proposals have **no Diocese/legal approval**. No final
retention periods, lawful-processing determination or POPIA compliance claim is made.
Michael's original concept/development attribution is retained. No production data
migration or confidential-use authorization is implied.

## Data inventory and purposes

| Category                     | Data and copies                                                                                          | Purpose / access dependency                                                                                  | Retention decision                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| authentication               | Better Auth identity, verified email, password hash, sessions, verification/reset tokens                 | registration, authentication/recovery; trusted server cookies; auth runtime is privileged within auth schema | operational account lifetime versus expired sessions/tokens must be decided separately             |
| clergy profile               | title/name/parish/optional phone, approval state                                                         | identity and Diocese approval; own profile and explicit approver/admin reads                                 | active profile, correction, departure and rejected registration policies pending                   |
| approval evidence            | decisions, reasons, actor/time, ID-only audits                                                           | access accountability; approver capability; append-only history                                              | evidence obligations and restricted retention pending                                              |
| reviewer onboarding          | exact identity/mailbox, token digest, encrypted delivery envelope, issuance/accept/revoke events         | explicit trusted authorization and mailbox proof; owner-only outbox/operator boundary                        | one-hour operational proof expiry is implemented; retained evidence/captured copies policy pending |
| reviewer assignments         | reviewer/submission/revision, assignment/revocation actor/time                                           | exact current revision access; live reviewer eligibility                                                     | historical assignment evidence policy pending                                                      |
| submission content           | titles, abstracts, keywords, category, confidentiality, status, immutable revision snapshots             | author drafting and assigned review; accepted non-confidential repository projection                         | version retention, withdrawal and publication review pending                                       |
| review decisions             | outcome, author feedback, private reviewer notes, assignment/revision/idempotency evidence               | decision accountability; current assignment-scoped private notes; safe author feedback projection            | historical review evidence separated from active records; no cleanup authorized                    |
| private documents            | original PDF filename/bytes, opaque key, size/hash, excluded status; private volume/backups              | authorized attachments; clean scan plus RLS and mandatory download audit                                     | retained revisions, exclusions and quarantine have separate pending policies                       |
| scanning/quarantine          | stored hashes, engine/definition metadata, attempts/times/categories/correlation, infected bytes         | fail-closed safety and controlled investigation; restricted worker                                           | no infected-file deletion or investigation viewer; ownership/legal approval pending                |
| download audits              | actor/submission/document IDs, stage/outcome/time/correlation                                            | authorized transfer accountability; mandatory pre-transfer commits                                           | immutable evidence obligations pending; stream-ended is not proof of recipient receipt             |
| email outboxes               | recipient/sender snapshots, event references, retry/lease/errors, encrypted invitation proof             | transactional notifications with stable payload/key; operator workers                                        | completed payload versus immutable decision evidence periods pending                               |
| captured email               | plaintext recipient/message and verification/reset/invitation links under private ignored `.local/email` | disposable testing only, 0700 directory/0600 messages, no web viewer                                         | sensitive derived credential copy; test-specific cleanup only; organizational policy pending       |
| application/host logs        | bounded categories, IDs/correlation, aggregate counts; host/provider logs                                | reliability/security response; protected operators                                                           | rotation/access/retention pending, never record contents/cookies/proofs/raw provider errors        |
| backups/derived copies       | DB auth/metadata/audits/settings/outbox plus paired private volume and separately protected secrets      | disaster recovery; encrypted restricted backups and isolated restore                                         | backup expiry, restored holds/deletion handling, provider copies and RPO/RTO pending               |
| legacy deferred chat/offline | isolated historical chat/mute rows and user-scoped IndexedDB/outbox                                      | remains outside active migration; no private-response service-worker cache                                   | separate authorization and privacy work; do not activate under Phase 3F                            |

Existing page chrome also requests Google Fonts and a configured crest asset host.
Those services can receive browser network metadata even though active private pages
set no-referrer. Review/self-host these assets and their provider/notice implications
before confidential launch; Phase 3F preserves the existing design/attribution.

## Consent and notice versioning

Registration displays the existing clearly labelled draft repository notice and
requires an explicit acknowledgement. Versioned append-only consent events record
acceptance/withdrawal. Live authorization uses the latest event ordered by timestamp
and ID and the current repository notice version (`repository-v1`); withdrawn or
obsolete consent denies content access. Pending/approved identities can acknowledge
the current draft under existing onboarding rules. Private-chat consent remains
separate and is not enabled by this phase. Consent does not substitute for verified
identity, approval, capabilities, revision assignment or scan safety.

Before launch, Diocese/legal owners must approve processing purposes, notice text,
controller/responsible-party contact details, recipients/operators, subject-rights
channels and notice version/cutover procedure. Adopt approved wording/version through
a reviewed forward change with deliberate re-consent behavior; do not relabel existing
acceptance as acceptance of text never shown. Password/session security and operational
processing grounds also need legal review; this technical consent gate does not decide
all lawful-processing questions.

## Typed policy and read-only preview

`src/lib/privacy/retention.ts` defines distinct categories for active records, review
history, immutable audit evidence, submission versions, quarantined files, temporary
uploads, notification payloads, invitation proofs, sessions/tokens, logs and backups.
Every default is `pending`, with **no duration** and unresolved legal hold. A policy
requires explicit approval reference and clear hold status before a hypothetical cutoff
can be computed. Immutable categories never produce a disposal cutoff in this model.
An active hold or unresolved hold blocks eligibility. No automatic deletion exists.

`bun run retention:preview` emits aggregate counts and blocked eligibility without
names, emails, titles, keys, proofs or contents. Logs/backups outside the database
remain explicitly uncounted. Temporary-upload row counts are not a complete inventory
of orphan filesystem parts; use the storage inventory too. Even a future approved
preview is not authorization to dispose, and must account for record-specific holds,
related tables, restored copies and backup obligations. Current previews show zero
eligible records because all policy decisions remain pending.

Any future disposal workflow must add reviewed, restricted record-specific legal-hold
metadata, authorization, exact operator confirmation, dry-run evidence and referential-
integrity handling. A category-level policy cannot establish that each subject/object
has no hold. Do not implement generic age-based deletion, delete immutable evidence to
meet a target, or permanently destroy infected files in this phase.

## Subject rights and organizational decisions

Prepare a verified request/intake channel for access, correction, objection and erasure
requests. Verify identity without disclosing another person's records; identify all
linked account IDs, revisions, private notes, audit references, recipient snapshots,
provider copies, captures, logs and paired backups. Legal owners must decide exemptions,
retention/hold obligations, third-party confidentiality, redaction and response timelines.
An author's feedback projection must not become a route to another person's private
reviewer notes. Corrections should preserve necessary immutable evidence through
approved append-only correction/anonymization designs, not historical overwrites.

Maintain a controlled request register, human review/approval, evidence of decisions
and restricted delivery. Define account suspension versus erasure, withdrawal of shared
resources, downstream copies and notice updates. These workflows are future work;
there is no public subject-data export or delete endpoint now.

Backups must be encrypted, paired consistently with storage, access-controlled and
restore-tested. Agree backup durations, legal holds, restore-time reapplication of
approved restrictions, derived-copy disposal and provider/operator terms before launch.
Do not promise immediate erasure from immutable evidence or backups without approved
technical/legal procedures. Neither already delivered email nor transferred bytes can
be recalled by database revocation.

Launch blockers: approved notice and organizational policy; accountable Diocese data
owner/privacy contact; operator/provider agreements and access inventory; retention
and hold decisions per category; subject-rights and incident-response runbooks; backup
and restoration evidence; quarantine investigation/disposal ownership; browser/manual
accessibility acceptance; reviewed production roles, scanner and infrastructure.

Reference for the responsible legal review: [official published POPIA Act](https://www.justice.gov.za/legislation/acts/2013-004.pdf).
This inventory supplies technical facts for that review and does not approve a policy.

For an independently reviewed hypothetical policy, the guarded CLI accepts a local
`CAPE_RETENTION_POLICY_FILE` JSON matching the typed structure. It validates category
keys, statuses, bounded whole-day durations, approval references and hold flags, and
forces immutable evidence categories to remain immutable. Queries run in a PostgreSQL
read-only transaction. Only settled notification payloads and expired sessions/tokens
are counted in their respective operational projections. Every output remains marked
hypothetical and requires record-specific hold review; no write/disposal function is
provided. Keep policy files private and do not put subject-specific details in them.

## Phase 4 operational metadata

Shared limiter rows contain only purpose/HMAC digest, saturated hit count and expiry;
no plaintext mailbox/IP/password/token is stored. They are ephemeral enforcement state,
not immutable consent/security history. Expired buckets are removed in bounded batches
as part of window management, with a 50,000-active-bucket cap. Structured denial logs
contain only purpose and random correlation ID; their log retention/access still needs
organizational approval. A party holding the auth secret can compute candidate HMACs,
so treat database/log access as protected; no claim of irreversible anonymization is made.
See the [approval register](privacy-approval-register.md) for all pending policy decisions.
