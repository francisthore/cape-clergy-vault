export type EmailKind = "verification" | "reset" | "pending" | "approved" | "rejected";
const content: Record<EmailKind, [string, string, string]> = {
  verification: [
    "Verify your email address",
    "Confirm your email address to continue your clergy registration. This link expires in one hour.",
    "Verify email",
  ],
  reset: [
    "Reset your password",
    "A password reset was requested for your Cape Clergy Vault account. This link expires in one hour. If you did not request this, you can ignore this email.",
    "Reset password",
  ],
  pending: [
    "Registration received",
    "Your email address has been verified. Your registration is awaiting approval. You will be notified once your account has been approved.",
    "View account status",
  ],
  approved: [
    "Account approved",
    "Your clergy registration has been approved. Sign in to view your account.",
    "Sign in",
  ],
  rejected: [
    "Registration update",
    "Your registration has been reviewed. Sign in to view your account status.",
    "View account status",
  ],
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function emailTemplate(kind: EmailKind, url: string) {
  const [subject, message, action] = content[kind];
  return {
    subject: `${subject} — Cape Clergy Vault`,
    text: `Cape Clergy Vault\nAnglican Diocese of Cape Town\n\n${subject}\n\n${message}\n\n${action}: ${url}\n\nTheological Education Formation and Training`,
    html: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px;background:#f8f5f0;color:#282126;font:16px/1.6 Arial,sans-serif"><main style="max-width:560px;margin:auto;background:white;padding:24px;border-top:5px solid #702d38"><p style="color:#702d38;font-size:22px">Cape Clergy Vault</p><p>Anglican Diocese of Cape Town</p><h1 style="font-size:24px">${subject}</h1><p>${message}</p><p><a style="color:#702d38;font-weight:bold" href="${escape(url)}">${action}</a></p><p style="font-size:14px;overflow-wrap:anywhere">If the link does not open, copy this address:<br>${escape(url)}</p><hr><p>Theological Education Formation and Training</p></main></body></html>`,
  };
}
