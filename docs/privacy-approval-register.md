# Diocese privacy and operational approval register

Prepared 6 November 2026. **All decisions below are pending.** No approver name,
legal wording, approval date or evidence is invented. Responsible offices are proposed
routing destinations; the Diocese must designate the accountable person/deputy.
Technical controls and automated tests do not establish POPIA or WCAG compliance.
See the existing [privacy/retention inventory](privacy-retention-readiness.md).

| Decision required                                      | Proposed responsible office                  | Options / requested decision                                                                        | Risk if unresolved                                  | Status                           | Evidence/reference | Date approved |
| ------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------- | ------------------ | ------------- |
| Processing purpose/lawful basis and notice             | Diocese Information Officer/legal adviser    | Review the current draft purpose/notice; approve wording/version before real collection             | Invalid notice or processing basis                  | Awaiting organizational approval | None               | —             |
| Consent and withdrawal model                           | Information Officer/repository owner         | Approve separate registration/repository notice, withdrawal consequences and version adoption       | Users misunderstand access/withdrawal               | Awaiting organizational approval | None               | —             |
| Data controller/operator and provider responsibilities | Diocese leadership/legal adviser             | Identify accountable offices, hosting/email operators and agreements                                | Unowned processing/security duties                  | Awaiting organizational approval | None               | —             |
| Clergy approval/reviewer authorization ownership       | Repository governance office                 | Name trusted exact-identity authorizers and deputies; preserve independent capabilities             | Unauthorized privileged access                      | Awaiting organizational approval | None               | —             |
| Reviewer confidentiality                               | Theological review governance/legal adviser  | Approve responsibilities, training, scope and handling of private notes                             | Confidential content disclosure                     | Awaiting organizational approval | None               | —             |
| Retention per category                                 | Information Officer/records office           | Adopt reviewed durations/events per inventory; leave current defaults pending until then            | Premature destruction or excessive retention        | Awaiting organizational approval | None               | —             |
| Holds, investigation and quarantine disposal           | Information Officer/security/records offices | Define hold placement/release authority, scanner investigation and approved disposal procedure      | Destruction of evidence or unsafe release           | Awaiting organizational approval | None               | —             |
| Subject access and identity verification               | Information Officer                          | Named intake, verification, response/exception workflow; privileged third-party/private-note review | Wrong-person disclosure or unhandled requests       | Awaiting organizational approval | None               | —             |
| Corrections and deletion requests                      | Information Officer/records office           | Correct mutable profile data with history; assess deletion against immutable evidence/holds/backups | Evidence corruption or misleading deletion promises | Awaiting organizational approval | None               | —             |
| Backup policy/key custody                              | Infrastructure owner/Information Officer     | Approve encrypted off-host location, custodians/deputy, retention and access audit                  | Irrecoverable data or backup disclosure             | Awaiting organizational approval | None               | —             |
| RPO/RTO and drill schedule                             | Service owner/infrastructure office          | Consider proposed 24h RPO/one business day RTO; measure and approve alternatives                    | Unagreed recovery expectations                      | Awaiting organizational approval | None               | —             |
| Incident response and escalation                       | Information Officer/security/service owner   | Name incident lead, reporting contacts, legal notification process and evidence handling            | Delayed containment/reporting                       | Awaiting organizational approval | None               | —             |
| Capacity, quotas and abuse response                    | Service owner/infrastructure office          | Approve resource budgets, quotas, thresholds, escalation and fair-use policy                        | Disk exhaustion or denial of service                | Awaiting organizational approval | None               | —             |
| Live email acceptance                                  | Service owner/domain owner                   | Authorize exact recipients/message types/counts/time window and record provider evidence            | Unauthorized real delivery or misdirected links     | Awaiting organizational approval | None               | —             |
| Human accessibility/mobile acceptance                  | Service owner/accessibility participants     | Assign testers/devices and record checklist evidence                                                | Users excluded from sensitive workflows             | Awaiting organizational approval | None               | —             |
| Staging provisioning and launch authority              | Infrastructure owner/service owner           | Separate explicit staging scope; later separate production decision                                 | Accidental impact on other hosted applications      | Awaiting organizational approval | None               | —             |

## Draft approval pack, not adopted policy

The notice review should explain intended theological sharing/review and account
administration, categories collected, trusted recipients/reviewers, accepted public-to-
clergy versus confidential scope, provider/hosting locations, relevant rights/contact
process, retention decision status and security incident handling. Include the current
consent screens and exact notice versions. Do not copy this outline as approved legal
wording. Obtain independent legal review of the processing basis and required notices.

Attach data inventory, capability/RLS map, reviewer confidentiality workflow,
backup/recovery evidence, mail content projections, capture/log handling and the release
matrix. Explain that authors receive only safe review feedback, private notes are
separate, audits/histories are append-only, proof expires after one hour and transferred
bytes cannot be recalled. Protected email/capture material can itself contain secrets.

Subject requests: route to designated intake; independently verify exact identity;
log request reference without unnecessary personal details; identify affected systems,
third-party data, private notes, histories and backup copies; have the authorized office
review disclosure/correction/deletion/hold constraints; make no unsupported deletion
promise. Record decision, lawful exceptions and evidence. Technical disposal remains
out of scope. Pending requests/holds must prevent premature disposal decisions.

Incident procedure proposal: preserve audit/lease/object evidence; restrict affected
capabilities through existing authorized revocation paths; pause unsafe processing;
contain without broadening roles; escalate to designated incident/Information Officer;
assess provider/backup copies and reporting obligations with legal advice; record
recovery approval and post-incident actions. No statutory deadline is invented here.

Current retention preview remains read-only, with no adopted arbitrary durations,
automatic deletion, history purge or backup rotation. Hold investigation/release must
be approved and recorded before any future disposal design. Updating this register
requires real decision evidence; an engineering test cannot close an approval row.

## Phase 4.2 notice review attachment

Review the complete proposed Version 1 wording in `src/lib/privacy/notice.ts` and
the compatibility treatment in [privacy readiness](privacy-retention-readiness.md).
The acknowledgement reference is `repository-v1-proposed-2026-11-16`. Approve the
responsible office/contact, lawful bases, provider/transfer arrangements (including
Bouncer, Resend and Google Fonts), retention/holds and rights workflow before real
collection. Existing `repository-v1` records are retained exactly as recorded; their
continued local eligibility does not establish acceptance of this new text. All
organizational decisions in the register remain pending.

## Phase 4.3.1 review attachment (no approvals recorded)

Use the single [Diocese pilot approval pack](diocese-pilot-approval-pack.md) for the
current non-technical decision register. All organizational decisions remain open.
Technical updates: self-invitations and confidential self-assignment are blocked;
confidential PDF uploads/new external transfers fail closed; operational PDF limit
defaults to 4 MiB; fonts are served locally (B6's external-request observation is
superseded). No frozen acknowledged notice text/version was changed. Reconcile these
facts, draft wording about general “TEFT staff” access to private notes, and the
current acknowledgement/draft version distinction before adopting a notice.

A read-only inventory found two currently confidential PDFs with provider scan IDs.
This is an open restricted-investigation item for the responsible office; no real-data
classification, lawful-processing conclusion or incident notification decision has
been made. Preserve evidence and do not describe earlier transfers as reversed.

## V1 launch decision record — 23 November 2026

The product decision is to support real clergy and confidential PDFs. The evidence field for each organisational decision below is **open**. Enter the dated decision, accountable office, scope, effective date, review/withdrawal terms and restricted evidence reference before signing the launch record. Keep contracts, names, signatures and incident material in the restricted register.

| Record | Evidence required before activation |
| --- | --- |
| Ownership and privacy | Diocesan service owner and deputy, responsible party, Information Officer or delegated office, contact for rights requests and escalation, written decision covering proposed purposes and special personal information |
| Bouncer | Signed decision specifically covering complete confidential PDFs, service contract, sub-processors and locations, applicable international-transfer safeguards, content and metadata retention, incident contact, revocation conditions and approved provider account |
| Resend | Terms, locations, safeguards, named domain owner, approved sender and reply-to, verified domain, approved message classes and tightly bounded delivery test |
| Notice and acknowledgements | Reviewed wording, approval and effective date, distinct frozen version, registration and existing-user acknowledgement plan, evidence of the screens and a test of withdrawal. The published draft and an older acknowledgement do not supply this evidence |
| Retention and incidents | Adopted schedules for DB, files, quarantine, logs, emails and backup copies, holds and disposal authority, response lead, notification decision process, escalation exercise |
| Hosting and backups | Operator identities and access, physical and off-site locations, encryption and key custody, adopted RPO/RTO and retention, dated isolated restore, neighbour impact and signed four-unit acceptance |
| Historic confidential provider IDs | Restricted investigation, classification, provider handling and responsible-office decision for the two previously recorded items. Retain the original evidence |
| Final release | Signed acceptance matrix, residual risks, reviewers, dates, rollback authority and separate decisions for provider test windows and real-clergy launch |

Use the Bouncer decision's opaque register ID as the approval reference in PostgreSQL. A database row points to the evidence. It does not establish the legal basis or replace the signed decision.
