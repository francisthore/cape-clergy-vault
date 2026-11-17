# Cape Clergy Vault: decision pack for a controlled pilot

Prepared 17 November 2026 (Africa/Johannesburg) for Michael, TEFT leadership and the
Diocese's Information Officer or responsible office. **For decision, not an approval.**
No permission, effective date, named office-holder or legal conclusion is implied.

## What is being proposed

Cape Clergy Vault lets eligible clergy submit theological ideas and PDF resources to
TEFT, receive review feedback and find accepted resources shared with eligible clergy.
A working development demonstration uses invented accounts and documents. A live pilot
would collect real people's information and requires separate diocesan authority,
provider arrangements and operational safeguards. Passing software tests does not
supply those decisions. This pack does not certify POPIA compliance.

The recommendation is to keep demonstrations synthetic, authorize an isolated staging
exercise separately, and defer real collection until the decisions below have evidence.
Confidential PDFs must remain unavailable for upload; a checkbox cannot approve an
external processor or make the confidentiality restrictions disappear.

## Information and access

The application processes names, clergy titles, parishes, email addresses, optional
phone numbers, account security records, eligibility decisions, permissions and privacy
acknowledgements. Resources contain descriptions, keywords, confidentiality choices,
PDFs, revisions, feedback and private reviewer notes. Security screening, file access,
administrative history, email delivery records, operational logs and backups also
contain information. Submissions might mention parishioners or other third parties.
TEFT should discourage unnecessary third-party information and agree permitted material.

Clergy eligibility and some theological content can reveal religious affiliation or
belief. The Diocese's adviser must determine the applicable ordinary and special
personal-information grounds and safeguards. Relevant statutory provisions include
POPIA sections 11 and 26–28; the [Department of Justice text](https://www.justice.gov.za/legislation/acts/2013-004.pdf)
and the [Information Regulator's guidance](https://inforegulator.org.za/wp-content/uploads/2020/07/InfoRegSA-GuidanceNote-Processing-SpecialPersonalInformation-20210628.pdf)
are references for that review, not a finding that an exception applies here.

| Person or capability                     | Intended access                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Author                                   | Own submissions, attachments and author-facing feedback                                                         |
| Eligible approved clergy                 | Accepted resources that are not confidential                                                                    |
| Assigned reviewer                        | Only the current exact revision assigned to them, while their authorization and eligibility remain valid        |
| Registration approver                    | Registration decisions; no automatic confidential-resource access                                               |
| Review coordinator                       | Routing information and assignments; confidential titles, author details, contents, PDFs and notes are withheld |
| Delegated access manager                 | Only explicitly delegated permission operations; cannot invite themselves as reviewer                           |
| Settings manager or system administrator | Their separate authorized functions; neither automatically becomes a reviewer                                   |
| Trusted infrastructure operator          | Technically powerful maintenance access, requiring separate restriction, accountability and oversight           |

Private reviewer notes remain separate from feedback shown to authors and are omitted
from author emails. “TEFT staff” must not be read as permission for all staff to see
notes. A coordinator may assign themselves only to someone else's non-confidential
work after independent reviewer activation. Confidential assignments require another
authorized coordinator. Authors cannot review their own work. A single administrator
cannot use the ordinary application to activate themselves and obtain confidential work.

Confidential means that acceptance does not add the work to the clergy repository.
It is available only to the author and an eligible assigned reviewer, subject to file
security checks. It is not a promise that technical operators cannot access underlying
systems, that a recipient cannot retain a download, or that transferred bytes can be
recalled. Confidential PDF processing currently has no approved operational route.

## PDFs and service providers

Uploads are held privately until security screening succeeds. An unknown, failed,
malicious or suspicious result does not permit download. Authors currently receive a
4 MiB operational limit, within the application's fixed 20 MiB safety ceiling. Larger
files require verification of Bouncer's actual upload destination and contract. The
application refuses confidential PDF uploads and the database blocks new confidential
Bouncer transfers. Ideas without PDFs can exercise review in a synthetic demonstration.

Bouncer receives complete PDF contents for scanning when external scanning is used.
A neutral filename is sent, but the document itself can identify people. Its published
[privacy policy](https://usebouncer.dev/privacy/) describes processing/storage in Mumbai,
content deletion within 24 hours and retention of scan metadata while the account
exists. These are provider statements, not independent deletion verification or a
signed Diocese agreement. The Diocese must assess processing terms, subprocessors,
confidentiality, incidents and international-transfer safeguards before any real PDF
is sent. Buying a plan or acknowledging a notice would not close that gate.

**A matter requiring investigation:** a read-only development inventory found two
currently confidential document records with Bouncer scan IDs. The minimal inventory
does not establish whether these are real or synthetic documents, their classification
at transfer, or the relevant authorization. Keep existing records and provider evidence.
The responsible office should authorize a restricted investigation and assess any
incident obligations with its adviser. No identifiers or contents are included here.
A software fix cannot reverse an earlier transfer. No provider was contacted in this
remediation and no notice has been sent to anyone on the Diocese's behalf.

Resend receives recipient addresses and transactional message contents when enabled,
including time-limited verification, reset and invitation links. Messages avoid
resource contents and private notes. Its agreement, processing locations, domain and
sender arrangements still require evidence. Hosting, database, storage and backup
locations and operator agreements have not been confirmed. There is no additional
paid infrastructure proposal; the intended host is the shared Ubuntu VPS, subject to
inspection and explicit authorization. No ClamAV installation is proposed on that host.
Browser fonts are now supplied by this application; pages no longer need Google Fonts.

## Retention, rights and incident responsibility

No diocesan retention schedule has been adopted. Histories remain append-only; no
cleanup of audit or review evidence is authorized by this pack. A deletion request
must be assessed against other people's information, records duties, holds and backups.
Proposed backup arrangements include coordinated database/files, encryption, separate
key custody and an approved off-host location. Daily backups, a proposed maximum loss
of 24 hours and restoration within one business day are recommendations for discussion,
not commitments. Recovery has been tested with invented data locally; actual host and
off-host recovery remain untested.

The Information Officer should designate an intake contact and identity-verification
procedure for access, correction, objection and deletion requests. Confirm the published
contact and Regulator details before activating the notice. Appoint an incident lead,
service owner, infrastructure custodian and deputies. An incident procedure should
preserve evidence, restrict unsafe processing, assess scope and provider copies,
involve the responsible office, decide legally required notifications and record
recovery authority. No legal notification deadline or approval is invented here.

## Decision register

Every row is **OPEN — no approval evidence supplied**. Record an actual reference,
approving office, date, scope and review date when a decision is made.

| Decision required                                   | Recommendation                                                                                                 | Approving office or role                                   | Evidence needed                                                                            | Status | If not approved                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------ |
| Responsible party, service purpose and ownership    | Confirm responsible body, Information Officer/contact, TEFT owner and deputies                                 | Diocesan leadership / Information Officer                  | Mandate and published contact                                                              | OPEN   | No real registration                             |
| Processing grounds, including religious information | Obtain purpose-specific legal assessment; distinguish acknowledgement from any consent needed                  | Information Officer / legal adviser                        | Written grounds and safeguards assessment                                                  | OPEN   | No real-clergy pilot                             |
| Final Notice V1 and activation                      | Reconcile the proposed draft, current acknowledged wording and technical corrections before adopting a version | Information Officer / legal adviser                        | Approved exact text, version, effective date and renewed-acknowledgement plan              | OPEN   | Draft remains unapproved                         |
| Confidential review personnel                       | At least two appropriately authorized people; independent invitations and confidential assignments             | TEFT leadership / access governance authority              | Named responsibilities, exact identities and independently recorded authorization          | OPEN   | Confidential review unavailable                  |
| Bouncer processing and cross-border transfers       | Keep confidential PDFs blocked; assess even non-confidential real PDFs before transfer                         | Information Officer / legal adviser / infrastructure owner | Contract, locations, subprocessors, retention, incident and transfer safeguards            | OPEN   | No real Bouncer uploads                          |
| Earlier possible confidential transfers             | Preserve evidence and commission a restricted investigation                                                    | Information Officer / responsible-party incident authority | Classification, synthetic/real-data assessment, times, authorization and provider evidence | OPEN   | Investigation and incident assessment unresolved |
| Resend delivery                                     | Approve domain, sender, data processing and a separately authorized test window                                | Domain owner / service owner / Information Officer         | Provider agreement, locations, DNS and limited delivery evidence                           | OPEN   | Capture-only demonstrations                      |
| Shared hosting and isolated staging                 | Inspect capacity and separation; approve synthetic staging only first                                          | Infrastructure owner / service owner                       | Target, ownership, TLS, namespaces, permissions and resource-budget evidence               | OPEN   | No VPS deployment                                |
| Retention, holds, logs and disposal                 | Adopt category-specific periods and hold authority before any deletion process                                 | Information Officer / records office                       | Signed schedule and disposal/hold procedure                                                | OPEN   | No automatic deletion or retention promise       |
| Backup destination, custodians and recovery targets | Approve encrypted off-host storage, independent keys and measured restore drill                                | Infrastructure owner / Information Officer / service owner | Destination agreement, key recovery, retention and restoration evidence                    | OPEN   | No real pilot relying on untested recovery       |
| Rights handling and incident response               | Assign intake, lead, deputies and escalation procedures                                                        | Information Officer / responsible office                   | Approved workflow and exercised contact/escalation record                                  | OPEN   | No real pilot                                    |
| User acceptance and controlled launch               | Approve participant scope, support, quotas, human accessibility/mobile acceptance and stop criteria            | TEFT leadership / service owner                            | Acceptance evidence and explicit launch decision                                           | OPEN   | Synthetic demonstration only                     |

The latest draft is [Privacy Notice V1](privacy-notice-v1-draft.md), with detailed
[open decisions](privacy-notice-v1-open-decisions.md). It is not in force. The current
registration acknowledgement remains `repository-v1-proposed-2026-11-16`; historical
`repository-v1` evidence is preserved. Neither acknowledgement supplies diocesan
approval. The technical [remediation report](phase-431-pilot-remediation-report.md)
and [deployment preflight](phase-5-deployment-preflight.md) provide supporting evidence.
