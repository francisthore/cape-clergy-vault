export const retentionCategories = [
  "activeRecords",
  "reviewHistory",
  "auditEvidence",
  "submissionVersions",
  "quarantinedFiles",
  "temporaryUploads",
  "notificationPayloads",
  "invitationProofs",
  "sessionsAndTokens",
  "logs",
  "backups",
] as const;
export type RetentionCategory = (typeof retentionCategories)[number];
export type RetentionRule = {
  status: "pending" | "approved";
  days: number | null;
  approvalReference: string | null;
  legalHold: "unresolved" | "clear" | "held";
  immutable: boolean;
};
export type RetentionPolicy = { version: string; rules: Record<RetentionCategory, RetentionRule> };
export const pendingRetentionPolicy: RetentionPolicy = {
  version: "phase3f-draft",
  rules: Object.fromEntries(
    retentionCategories.map((category) => [
      category,
      {
        status: "pending",
        days: null,
        approvalReference: null,
        legalHold: "unresolved",
        immutable: ["reviewHistory", "auditEvidence", "submissionVersions"].includes(category),
      },
    ]),
  ) as RetentionPolicy["rules"],
};
export function retentionCutoff(rule: RetentionRule, now = new Date()): Date | null {
  if (
    rule.status !== "approved" ||
    !rule.approvalReference ||
    rule.legalHold !== "clear" ||
    rule.immutable ||
    rule.days === null ||
    !Number.isInteger(rule.days) ||
    rule.days < 1
  )
    return null;
  return new Date(now.getTime() - rule.days * 86400000);
}
// Reports only. A cutoff is never authorization to dispose of records or backup copies.
