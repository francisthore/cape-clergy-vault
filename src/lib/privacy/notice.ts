// This content revision has its own immutable acknowledgement identifier.
export const registrationNotice = {
  version: "repository-v1-proposed-2026-11-16",
  label: "Privacy Notice (Version 1)",
  warning:
    "Proposed for Diocese approval. Pre-launch demonstration only: use synthetic information and PDFs. Do not enter real personal or confidential information.",
  sections: [
    {
      heading: "Responsible office and contact",
      text: "Cape Clergy Vault is intended to be administered by Theological Education Formation and Training (TEFT), Anglican Diocese of Cape Town. The Diocese must confirm the responsible party, Information Officer and authorised contact before launch. Contact: [Diocese/TEFT privacy office — contact details awaiting authorisation]. For this demonstration, raise questions with the project owner through your existing contact.",
    },
    {
      heading: "Information collected",
      text: "Registration collects your clergy title, full name, parish or ministry, email address and optional phone number. Authentication uses a protected password record, verification and reset records, and session cookies. We also record notice acknowledgements, access and security events, registration outcomes and capability grants. Submissions include titles, descriptions, keywords, confidentiality choices, PDF files, revisions, review decisions and feedback.",
    },
    {
      heading: "Registration and theological review",
      text: "We use registration information to verify email ownership, assess clergy eligibility, administer account approval and communicate account outcomes. Approved clergy with current repository acknowledgement can prepare and send theological resources to TEFT. Registration approval, theological acceptance and PDF security clearance are separate checks. Private reviewer notes remain separate from the feedback shown to authors.",
    },
    {
      heading: "Sharing, confidentiality and access",
      text: "Authors can access their own submissions. Authorised reviewers need an active assignment to the exact revision and live clergy, reviewer and repository permissions. Accepted non-confidential resources can be shared with eligible repository clergy. Confidential resources remain private to the author and authorised assigned reviewers; acceptance does not publish them to the repository. Administrative capabilities do not automatically allow access to confidential resources or private review notes. Trusted operators may process records for support, security and legal duties. Access controls reduce risk but cannot recall files already downloaded.",
    },
    {
      heading: "PDF screening and service providers",
      text: "PDFs enter private quarantine and cannot be downloaded until verified clean security evidence matches the file. Where Bouncer is configured, the complete PDF is transferred to Bouncer for malware screening, including its external upload infrastructure. ClamAV is an alternative scanner. Email delivery uses Resend when enabled, and hosting/database operators also process information. The current interface requests Google Fonts, which can receive browser network metadata; these fonts should be self-hosted or separately reviewed before launch. These are third-party processing arrangements; we do not promise that information is never shared with providers. Provider agreements, locations, retention and safeguards for transfers outside South Africa require Diocese review before real use. No confidential PDF should be submitted to an external scanner until that use is specifically authorised.",
    },
    {
      heading: "Retention and your information rights",
      text: "Retention periods and the request-handling process await Diocese approval. Account, consent, approval, review, submission and security histories are retained as evidence; backup and provider copies may also exist. You may request access, correction, object to processing, or ask for deletion where applicable through the designated office once confirmed. Requests require identity verification and assessment of other people’s information, legal duties, security evidence, record holds and backups. Deletion is not automatic or unconditional. No automatic history purge is enabled.",
    },
    {
      heading: "Acknowledgement and separate choices",
      text: "The required checkbox records that you have read and acknowledge this notice for registration and repository processing. It is not blanket permission for unrelated processing, a waiver of information rights, or evidence of Diocese legal approval. The responsible office must approve the lawful basis and any separate consent requirements before launch. Private chat is outside the active self-hosted workflow and this acknowledgement does not enable it. Repository acknowledgement and any future private-chat consent remain separate. Do not upload information about other people unless you have the necessary authority and a lawful basis.",
    },
  ],
} as const;
