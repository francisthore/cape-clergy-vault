// PROPOSED Privacy Notice Version 1: a draft for Diocese review. NOT ACTIVE.
//
// This content is deliberately separate from notice.ts. The registration form, its
// acknowledgement checkbox and the database acceptance rules (app.provision_clergy,
// app.has_consent, the consent_append policy and the reviewer assignment check) still accept
// only `registrationNotice.version`. Activating this draft would need a reviewed database
// migration and written Diocese authorisation. Until both exist, nothing here may be shown as
// the acknowledged text or stored as an acknowledgement.
//
// Bracketed placeholders are facts the Diocese has not yet confirmed. Do not replace them with
// invented names, addresses, approvals or durations.

export const privacyNoticeV1Draft = {
  identifier: "repository-v1-draft-2026-11-23",
  status: "draft-not-approved",
  active: false,
  label: "Privacy Notice (Version 1) — proposed draft",
  warning:
    "Proposed draft for Diocese review. Not approved and not in force. During release acceptance use synthetic information and PDFs. Do not enter real personal or confidential information.",
  governingLaw:
    "Protection of Personal Information Act 4 of 2013 (POPIA), South Africa. Statutory references are for the Diocese's legal adviser to confirm.",
  sections: [
    {
      id: "1-introduction-and-responsible-party",
      heading: "1. Introduction and responsible party",
      paragraphs: [
        "Cape Clergy Vault is a secure repository for theological resources, provided for the Anglican Diocese of Cape Town through Theological Education Formation and Training (TEFT). Approved clergy register, submit theological resources and PDF files for review, and browse accepted resources that are not marked confidential. TEFT staff manage registrations, submission intake, assignment and theological review.",
        "Responsible party: [Confirmed responsible party — awaiting Diocese authorisation]. Registered or physical address: [awaiting Diocese authorisation]. Information Officer: [name and deputy — awaiting Diocese appointment]. Privacy contact email: [awaiting Diocese authorisation].",
        "This notice describes the processing carried out by this application. It is a proposed draft. It does not replace legal advice and does not state that the platform is compliant with POPIA.",
      ],
    },
    {
      id: "2-information-collected",
      heading: "2. Information we collect",
      paragraphs: [
        "Registration: clergy title, full name, parish or ministry, email address, and an optional phone number.",
        "Account and sign-in: a protected password record (passwords are not intentionally stored in plain text), sign-in sessions, time-limited email verification and password-reset records, and security and rate-limit records that help block abuse.",
        "Status and permissions: verification and registration status; approval status (pending, approved, rejected, suspended or reactivated); roles granted to an account, such as clergy, approver, review coordinator, reviewer, access manager or settings manager; and reviewer invitation records.",
        "Privacy records: the version of this notice that you acknowledged, when you acknowledged it, and any later withdrawal event.",
        "Resources and submissions: titles, descriptions, keywords, the category, your confidentiality choice, uploaded PDF files and their technical details (for example size, type and checksum), revisions, and lifecycle history such as received, assigned, under review, accepted or returned.",
        "Review: feedback shown to you as the author, and private reviewer notes. Private reviewer notes are available to reviewers authorised for the assigned revision, and are never shown to authors.",
        "Security screening: malware screening results and quarantine status for each PDF.",
        "Access, download and audit records: who viewed or downloaded a file and when, administrative changes, and the audit history needed to explain them.",
        "Notifications: records of emails the application sends for your account or submissions (recipient, message type, time and delivery status).",
        "Operational logs and backups: technical logs needed to run and secure the service, and backup copies of the database and stored files, where backups are in use.",
        "Information about other people: theological material may mention other people, such as parishioners, colleagues or authors quoted. Include only what is necessary, and make sure you have the authority and a lawful basis to share it. Do not upload personal information about others unless that is permitted.",
      ],
    },
    {
      id: "3-purposes-of-processing",
      heading: "3. Why we use your information",
      paragraphs: [
        "We use information to decide whether a clergy registration is eligible and to administer account approval, suspension and reactivation.",
        "We use it to sign you in, keep your account secure, and operate the platform, including your submissions and file uploads.",
        "We use submission information to coordinate intake, assign reviewers, carry out theological review and return feedback.",
        "We use accepted, non-confidential resources to share them with eligible clergy in the repository.",
        "We send notifications about account changes and submission progress.",
        "We use security, audit and access records to screen files, prevent misuse, investigate incidents and support technical maintenance.",
        "We keep lawful records of decisions, acknowledgements, access and changes, and meet governance and legal duties.",
      ],
    },
    {
      id: "4-lawful-basis-and-special-personal-information",
      heading: "4. Lawful basis and special personal information",
      paragraphs: [
        "Clergy membership and some submitted theological material may reveal religious beliefs or affiliation. POPIA treats religious beliefs as special personal information (section 26), and its processing is restricted unless a specific exception in sections 27 or 28 applies. The Diocese must confirm, with legal advice, which exception applies to each activity and what safeguards are required. [Lawful basis and special personal information exceptions — awaiting Diocese legal review.]",
        "The grounds for ordinary personal information under section 11 of POPIA, such as consent, contractual necessity, legal obligation or legitimate interest, must also be confirmed for each activity. [Section 11 grounds — awaiting Diocese legal review.]",
        "Ticking the acknowledgement checkbox confirms that you have read this notice. It is not blanket consent to every type of processing, to any transfer outside South Africa, or to any use not described here. Where consent is required, it will be requested separately.",
      ],
    },
    {
      id: "5-required-and-optional-information",
      heading: "5. Required and optional information",
      paragraphs: [
        "Required: clergy title, full name, parish or ministry, email address, password, and the acknowledgement checkbox. We need these to verify your email address, assess eligibility and create your account. Without them, you cannot register or use the repository.",
        "Optional: phone number. Leaving it blank does not affect registration. [Purpose of the phone number, if any — awaiting Diocese confirmation.]",
        "Not providing required details limits what you can do in the repository. It does not waive any of your rights under POPIA.",
      ],
    },
    {
      id: "6-access-and-sharing",
      heading: "6. Who can access information and how it is shared",
      paragraphs: [
        "You can see your own profile, submissions, revisions, author feedback and account status.",
        "Approvers manage clergy registration decisions, including approval, rejection, suspension and reactivation. Approval rights are separate from reviewer rights and do not, by themselves, give access to confidential material. [Verify against live role permissions before approval.]",
        "Review coordinators see routing records for submissions and make exact-revision reviewer assignments. That role cannot read resource contents, PDF files or private reviewer notes.",
        "Access managers can inspect and change only the capabilities explicitly delegated to them for named accounts. They cannot widen their own delegation or grant system administration. [Confirm before approval whether this role gives any access to submission content.]",
        "Assigned theological reviewers can access only the exact revision assigned to them, and only while both their reviewer authorisation and the assignment are active. Reviewers cannot review their own submissions or amended revisions without a new assignment.",
        "Settings managers manage email configuration and related application settings. That capability is separate from clergy approval and theological review. [Verify against live role permissions before approval.]",
        "Accepted, non-confidential resources can be seen by approved clergy with a current repository acknowledgement. Confidential works remain private to the author and to authorised, assigned reviewers. Acceptance does not publish a confidential work to the repository.",
        "Private reviewer notes are available to reviewers authorised for the assigned revision. They are not shown to authors, and they are not included in author notifications.",
        "Administrative roles do not automatically allow access to confidential resources or private reviewer notes. No single administrator can read everything in the system.",
        "A small number of trusted technical operators may need controlled access to the database, files or logs for maintenance, security or incident handling. That access is limited to what is necessary. [Operator controls and disclosure rules — awaiting Diocese confirmation.]",
        "Access controls reduce risk but cannot recall a copy of a file that has already been downloaded.",
      ],
    },
    {
      id: "7-service-providers-and-international-transfers",
      heading: "7. Service providers and transfers outside South Africa",
      paragraphs: [
        "Resend provides transactional email (account, verification, reset and submission notifications) when email is enabled. Resend receives the recipient address and the message content, including any sign-in or review link. [Resend agreement, processing location and safeguards — awaiting Diocese review.]",
        "Bouncer provides malware screening for uploaded PDFs when it is configured. The complete PDF is sent to Bouncer for scanning through its upload infrastructure. Bouncer's published privacy policy, as summarised on 17 November 2026 and to be re-checked before launch, states that its data is stored on AWS infrastructure in the Mumbai (ap-south-1) region in India; that uploaded file content is deleted within 24 hours; and that scan metadata is retained while the provider account is active. These are the provider's statements. The Diocese has not independently verified them.",
        "Because Bouncer processing takes place outside South Africa and a PDF may contain special personal information, transfers must meet POPIA section 72 requirements before real use. Confidential PDFs are not to be sent to an external scanner unless the Diocese specifically approves that use with the required safeguards. [Bouncer approval status and section 72 safeguards — awaiting Diocese decision.]",
        "V1 proposes sending each newly authorised confidential PDF in full to Bouncer for screening. Each PDF may be up to 4 MiB. The upload screen explains the transfer before you attach the file. The Diocese must record its decision before this route opens. Files attached under earlier arrangements stay outside this approval. A clean result allows the normal private review workflow. Even after acceptance, confidential work stays outside the shared clergy repository.",
        "Hosting, database, file storage and backup services are run on infrastructure used for this application. [Hosting provider, physical locations and operator agreements — awaiting Diocese confirmation.]",
        "The application serves its fonts locally.",
        "No advertising or analytics services were found in the application code reviewed for this draft. [To be re-verified before launch.]",
      ],
    },
    {
      id: "8-security",
      heading: "8. Security",
      paragraphs: [
        "We restrict access by role and check permissions against the database on each request. Stored files are kept in private storage and are not published through public links. Downloads are authorised and recorded.",
        "Uploaded PDFs are held in quarantine until they have been screened and cleared. Access to the file is not allowed before clearance.",
        "Sign-in uses protected session cookies that page scripts cannot read. Connections should use encrypted transport (HTTPS) in every deployed environment. [Deployment TLS and monitoring evidence — to be confirmed at release.]",
        "Audit and history records are kept so that the Diocese can explain what happened. Sign-in-related links expire after one hour.",
        "No system is perfectly secure. If a security compromise affects personal information, the Diocese will assess it and notify affected people and the Information Regulator as POPIA requires. [Incident response and notification procedure — awaiting Diocese approval.]",
      ],
    },
    {
      id: "9-retention",
      heading: "9. How long we keep information",
      paragraphs: [
        "We keep records for as long as needed for their purpose, as required by law, or as set out in an approved retention schedule. [Retention periods for each category — awaiting Diocese approval. No periods have been adopted.]",
        "Categories covered by the schedule include: account and profile records; consent and approval records; review and submission history; audit and access records; uploaded files and quarantine records; notification records; sign-in sessions and temporary tokens; operational logs; and backups.",
        "Review decisions, submission history, audit evidence and consent records are kept as evidence. They may be changed only by adding new records, not by overwriting old ones. Any request to remove them will be assessed against legal duties, record holds and their evidential purpose.",
        "Backups and copies held by service providers may keep information for their own periods, as described in section 7. No automatic deletion of history is currently enabled.",
      ],
    },
    {
      id: "10-individual-rights",
      heading: "10. Your rights",
      paragraphs: [
        "Access: you may ask for a copy of the personal information we hold about you (POPIA section 23).",
        "Correction: you may ask us to correct or update inaccurate information (POPIA section 24).",
        "Objection: you may object to processing on reasonable grounds (POPIA section 11(3)).",
        "Deletion: you may ask us to delete information where the law allows. Some information must be kept as evidence or for legal reasons, as explained in section 9.",
        "Withdrawal: where processing relies on your consent, you may withdraw it. Withdrawal may mean that we can no longer provide some or all of the service.",
        "Verification: before responding, we verify your identity. We may ask questions to confirm it. We may refuse a request that cannot be verified, or that would reveal other people's information or affect security, legal duties, record holds or backups.",
        "Complaints: you may lodge a complaint with the Information Regulator of South Africa at inforegulator.org.za. [Verified official contact details — to be confirmed before publication.]",
        "To make a request, contact: [designated privacy office and Information Officer — awaiting Diocese authorisation].",
      ],
    },
    {
      id: "11-cookies-and-authentication",
      heading: "11. Cookies and sign-in",
      paragraphs: [
        "The sign-in session cookie keeps you signed in. It is marked HttpOnly, so page scripts cannot read it; it is set with SameSite=Lax; and it is marked Secure when the site is served over HTTPS. It is essential to sign-in and security.",
        "Email verification and password-reset links are time-limited. Changing your password ends existing sign-ins on your account.",
        "No advertising or tracking cookies were identified in the code reviewed. [Complete browser-storage and cookie inventory — pending verification before launch, since some legacy client code remains in the project.]",
        "Whether essential cookies require separate notice under the Diocese's policy is for the Diocese to confirm.",
      ],
    },
    {
      id: "12-changes-and-contact",
      heading: "12. Changes and contact",
      paragraphs: [
        "If this notice changes materially, the Diocese will publish a new revision with a new identifier, and will explain the change before it takes effect. The identifier of the revision you acknowledged will remain unchanged. [Notification method for changes — awaiting Diocese approval.]",
        "Version and effective date: [not yet approved — this draft is not in force].",
        "Contact: [designated privacy office, Information Officer and contact email — awaiting Diocese authorisation].",
      ],
    },
  ],
} as const;

export const privacyNoticeV1DraftSectionIds = privacyNoticeV1Draft.sections.map((s) => s.id);
