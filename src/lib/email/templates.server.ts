// Transactional email content and presentation.
//
// Each EmailKind has one specification. The HTML and plain-text versions are both generated
// from that specification, so they stay semantically equivalent. Recipients, delivery queues,
// idempotency keys and sender configuration live in the notification worker and EmailService
// and are not changed here.
//
// Expiry wording must match the implementation: verification and password-reset links expire
// one hour after they are sent (Better Auth expiresIn 3600 and its one-hour reset default), and
// reviewer invitations expire one hour after issue (reviewer_invitations expiry check).

export type EmailKind =
  | "registration_pending_alert"
  | "reviewer_invitation"
  | "review_assigned"
  | "submission_received"
  | "submission_intake"
  | "submission_accepted"
  | "submission_returned"
  | "test"
  | "verification"
  | "reset"
  | "pending"
  | "approved"
  | "rejected"
  | "suspended"
  | "reactivated";

// "team" closes with the TEFT sign-off. "neutral" is used for security and account-status
// messages, where a plain closing is more appropriate.
type Closing = "team" | "neutral";

export type EmailSpec = {
  subject: string;
  heading: string;
  paragraphs: readonly string[];
  action: string;
  closing: Closing;
};

export const emailSpecs: Record<EmailKind, EmailSpec> = {
  verification: {
    subject: "Verify your email address",
    heading: "Verify your email address",
    paragraphs: [
      "Thank you for starting your clergy registration with Cape Clergy Vault. Please confirm that this email address is yours so that we can continue.",
      "This link expires one hour after it was sent. If it has expired, you can request a new link from the Cape Clergy Vault sign-in page.",
      "If you did not start a registration, you can ignore this email.",
    ],
    action: "Verify email address",
    closing: "neutral",
  },
  pending: {
    subject: "Your clergy registration has been received",
    heading: "Your registration has been received",
    paragraphs: [
      "Thank you for registering with Cape Clergy Vault. Your email address is confirmed and your registration is now awaiting review.",
      "You can sign in at any time to see your account status. We will write to you when a decision has been made.",
    ],
    action: "View account status",
    closing: "team",
  },
  registration_pending_alert: {
    subject: "A clergy registration is awaiting review",
    heading: "A registration is awaiting review",
    paragraphs: [
      "A verified clergy registration has been received and is waiting for an approval decision.",
      "Please sign in and open the registrations page to see the current queue. The queue may already have changed, so please check the page before you act.",
    ],
    action: "Open registrations",
    closing: "team",
  },
  approved: {
    subject: "Your clergy registration has been approved",
    heading: "Your registration has been approved",
    paragraphs: [
      "We are pleased to confirm that your clergy registration has been approved.",
      "You can now sign in to the TEFT Repository to explore available resources and submit your own theological work for review.",
      "We look forward to your participation.",
    ],
    action: "Open the TEFT Repository",
    closing: "team",
  },
  rejected: {
    subject: "An update on your clergy registration",
    heading: "An update on your registration",
    paragraphs: [
      "We have completed the review of your clergy registration.",
      "Please sign in to Cape Clergy Vault to view your account status. If you have any questions, please contact the Diocese through your usual channel.",
    ],
    action: "View account status",
    closing: "team",
  },
  suspended: {
    subject: "Your account access has been suspended",
    heading: "Your account access has been suspended",
    paragraphs: [
      "Access to your Cape Clergy Vault account has been suspended.",
      "If you have questions, please contact the Diocese through your usual channel. You can sign in to view your account status.",
    ],
    action: "View account status",
    closing: "neutral",
  },
  reactivated: {
    subject: "Your account access has been restored",
    heading: "Your account access has been restored",
    paragraphs: [
      "Your access to Cape Clergy Vault has been restored. You can sign in again to view your account and continue your work.",
    ],
    action: "Sign in",
    closing: "team",
  },
  reset: {
    subject: "Reset your Cape Clergy Vault password",
    heading: "Reset your password",
    paragraphs: [
      "We received a request to reset the password for your Cape Clergy Vault account. Use the button below to choose a new password.",
      "This link expires one hour after it was sent. For your security, existing sign-ins on your account end when the password is changed.",
      "If you did not ask for this, you can ignore this email. Your password will not change unless the link is used. Please do not share this link with anyone.",
    ],
    action: "Choose a new password",
    closing: "neutral",
  },
  reviewer_invitation: {
    subject: "Reviewer invitation for theological review",
    heading: "Reviewer invitation",
    paragraphs: [
      "You have been invited to undertake assigned theological reviews for TEFT.",
      "Sign in with the account that received this invitation, then open the link below and explicitly accept. The link expires one hour after it was issued. Please keep it private and do not forward it.",
      "Accepting this invitation is separate from your clergy registration. Your clergy approval and your reviewer authorisation are considered separately.",
    ],
    action: "Open reviewer invitation",
    closing: "team",
  },
  review_assigned: {
    subject: "A resource has been assigned to you for review",
    heading: "Review assignment",
    paragraphs: [
      "A theological resource has been assigned to you for review.",
      "Sign in to open the reviewer workspace and read the revision assigned to you. Assignment details can change, so please check the workspace for the latest information before you begin.",
    ],
    action: "Open reviewer workspace",
    closing: "team",
  },
  // Submission received and intake kinds are part of the Phase 4.2.2 notification set.
  // Reconcile with the uncommitted worker and template changes when integrating.
  submission_received: {
    subject: "Your resource has been received by TEFT",
    heading: "Your resource has been received",
    paragraphs: [
      "Thank you for sharing your work with TEFT.",
      "Your resource has been received and is awaiting the next stage of the review process. You can follow its progress from My submissions.",
      "We will let you know when there is an update requiring your attention.",
    ],
    action: "View my submission",
    closing: "team",
  },
  submission_intake: {
    subject: "A theological submission is awaiting assignment",
    heading: "A submission is awaiting assignment",
    paragraphs: [
      "A resource has been received through Cape Clergy Vault and is awaiting reviewer assignment.",
      "Please open the TEFT submission inbox to check its current status, as it may already have been assigned.",
    ],
    action: "Open the TEFT submission inbox",
    closing: "team",
  },
  submission_accepted: {
    subject: "Your submission has been accepted",
    heading: "Your submission has been accepted",
    paragraphs: [
      "Thank you for your submission. Following theological review, TEFT has accepted your resource.",
      "Please sign in to view its current status and any feedback shared with you.",
    ],
    action: "View submission",
    closing: "team",
  },
  submission_returned: {
    subject: "An update on your theological submission",
    heading: "Your submission has been returned with feedback",
    paragraphs: [
      "Your submission has been reviewed and returned with feedback.",
      "Please sign in to read the reviewer's comments and make any requested changes. You can then submit a revised version for consideration.",
    ],
    action: "View feedback",
    closing: "team",
  },
  test: {
    subject: "Email configuration test",
    heading: "Email configuration test",
    paragraphs: [
      "This is a controlled test message, requested from the settings area of Cape Clergy Vault to check that email is configured correctly.",
      "Your email provider accepting this message does not confirm that it has reached your inbox. No action is needed.",
    ],
    action: "Open my account",
    closing: "neutral",
  },
};

// Colour values mirror the Diocese palette in src/styles.css. Email clients need literal values.
const palette = {
  page: "#FAF8F2",
  card: "#FFFFFF",
  blue: "#263A91",
  gold: "#A4862B",
  text: "#242632",
  muted: "#5C5A66",
  line: "#E4DDCD",
} as const;

const serif = "Georgia, 'Times New Roman', serif";
const sans = "Arial, Helvetica, sans-serif";
const crestAlt = "Diocese of Cape Town crest";
const footerLines = [
  "Theological Education Formation and Training (TEFT)",
  "Anglican Diocese of Cape Town",
  "You received this message because of your Cape Clergy Vault account.",
] as const;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function closingLines(closing: Closing): string[] {
  return closing === "team"
    ? ["Kind regards,", "The TEFT Team", "Anglican Diocese of Cape Town"]
    : ["Cape Clergy Vault"];
}

function renderText(spec: EmailSpec, url: string) {
  return [
    "Cape Clergy Vault",
    "Anglican Diocese of Cape Town",
    "",
    spec.heading,
    "",
    ...spec.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    `${spec.action}: ${url}`,
    "",
    ...closingLines(spec.closing),
    "",
    "--",
    ...footerLines,
  ].join("\n");
}

function renderHtml(spec: EmailSpec, url: string) {
  const crest = `${new URL(url).origin}/dct-crest-source.png`;
  const href = escapeHtml(url);
  const preheader = escapeHtml(spec.paragraphs[0] ?? spec.heading);
  const paragraphs = spec.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-family:${sans};font-size:16px;line-height:1.6;color:${palette.text};">${escapeHtml(paragraph)}</p>`,
    )
    .join("\n");
  const [firstClosing = "", ...restClosing] = closingLines(spec.closing);
  const closing = [
    `<p style="margin:24px 0 0;font-family:${sans};font-size:16px;line-height:1.6;color:${palette.text};">${escapeHtml(firstClosing)}</p>`,
    ...restClosing.map(
      (line) =>
        `<p style="margin:0;font-family:${sans};font-size:16px;line-height:1.6;color:${palette.text};">${escapeHtml(line)}</p>`,
    ),
  ].join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(spec.subject)}</title>
<style>
@media only screen and (max-width: 620px) {
  .email-card { padding: 24px 20px !important; }
  .email-heading { font-size: 22px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${palette.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${palette.page};">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${palette.page};">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td class="email-card" style="background:${palette.card};border:1px solid ${palette.line};border-radius:8px;padding:32px 36px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
<tr>
<td style="width:64px;vertical-align:middle;padding-right:16px;">
<img src="${escapeHtml(crest)}" width="64" height="88" alt="${escapeHtml(crestAlt)}" style="display:block;border:0;width:64px;height:auto;">
</td>
<td style="vertical-align:middle;">
<p style="margin:0;font-family:${serif};font-size:22px;font-weight:bold;color:${palette.blue};">Cape Clergy Vault</p>
<p style="margin:2px 0 0;font-family:${sans};font-size:13px;color:${palette.muted};">Anglican Diocese of Cape Town</p>
</td>
</tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td style="height:2px;background:${palette.gold};font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
<h1 class="email-heading" style="margin:0 0 20px;font-family:${serif};font-size:26px;line-height:1.25;font-weight:bold;color:${palette.blue};">${escapeHtml(spec.heading)}</h1>
${paragraphs}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
<tr><td bgcolor="${palette.blue}" style="background:${palette.blue};border-radius:6px;">
<a href="${href}" style="display:inline-block;padding:13px 24px;font-family:${sans};font-size:16px;font-weight:bold;line-height:1.2;color:#FFFFFF;text-decoration:none;">${escapeHtml(spec.action)}</a>
</td></tr>
</table>
<p style="margin:0 0 6px;font-family:${sans};font-size:14px;line-height:1.5;color:${palette.muted};">If the button does not work, copy this address into your browser:</p>
<p style="margin:0 0 8px;font-family:${sans};font-size:14px;line-height:1.5;color:${palette.muted};word-break:break-all;overflow-wrap:anywhere;">${href}</p>
${closing}
</td></tr>
<tr><td style="padding:18px 8px 0;font-family:${sans};font-size:12px;line-height:1.6;color:${palette.muted};text-align:center;">
${footerLines.map((line) => escapeHtml(line)).join("<br>")}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function emailTemplate(kind: EmailKind, url: string) {
  const spec = emailSpecs[kind];
  return {
    subject: spec.subject,
    text: renderText(spec, url),
    html: renderHtml(spec, url),
  };
}
