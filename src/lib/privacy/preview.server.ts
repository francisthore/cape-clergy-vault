import type { Sql } from "postgres";
import {
  retentionCategories,
  retentionCutoff,
  type RetentionPolicy,
  type RetentionCategory,
} from "./retention.ts";
// Fixed SQL identifiers only; never interpolate file-provided table names or predicates.
const sources: Partial<
  Record<RetentionCategory, { table: string; time: string; filter: string }[]>
> = {
  activeRecords: [{ table: "app.clergy_profiles", time: "created_at", filter: "true" }],
  reviewHistory: [{ table: "app.review_decisions", time: "created_at", filter: "true" }],
  auditEvidence: [{ table: "app.audit_events", time: "created_at", filter: "true" }],
  submissionVersions: [{ table: "app.submission_events", time: "created_at", filter: "true" }],
  quarantinedFiles: [
    {
      table: "app.documents",
      time: "created_at",
      filter: "state in ('quarantined','scanning','infected','scan_failed','legacy_unscanned')",
    },
  ],
  temporaryUploads: [{ table: "app.documents", time: "created_at", filter: "state='pending'" }],
  notificationPayloads: [
    { table: "app.approval_notifications", time: "created_at", filter: "delivered_at is not null" },
    {
      table: "app.reviewer_notifications",
      time: "created_at",
      filter: "delivered_at is not null or cancelled_at is not null",
    },
  ],
  invitationProofs: [
    { table: "app.reviewer_notifications", time: "created_at", filter: "sealed_token is not null" },
  ],
  sessionsAndTokens: [
    { table: "auth.sessions", time: "expires_at", filter: "expires_at<now()" },
    { table: "auth.verifications", time: "expires_at", filter: "expires_at<now()" },
  ],
};
export async function previewRetention(client: Sql, policy: RetentionPolicy) {
  return client.begin("read only", async (tx) => {
    const categories = [];
    for (const category of retentionCategories) {
      const rule = policy.rules[category],
        cutoff = retentionCutoff(rule),
        tables = sources[category];
      let records: number | null = tables ? 0 : null,
        eligible: number | null = tables ? 0 : null;
      for (const source of tables ?? []) {
        const [r] = await tx.unsafe(
          `select count(*)::int as records,count(*) filter(where $1::timestamptz is not null and ${source.time}<$1)::int as eligible from ${source.table} where ${source.filter}`,
          [cutoff],
        );
        records! += Number(r!["records"]);
        eligible! += Number(r!["eligible"]);
      }
      categories.push({
        category,
        records,
        eligible,
        cutoff: cutoff?.toISOString() ?? null,
        status: rule.status,
        blockedBy: !tables
          ? "external_inventory_required"
          : cutoff
            ? null
            : "unapproved_policy_or_unresolved_hold_or_immutable",
      });
    }
    return {
      event: "retention.preview",
      policy: policy.version,
      destructive: false,
      hypotheticalOnly: true,
      recordSpecificHoldReviewRequired: true,
      categories,
    };
  });
}
