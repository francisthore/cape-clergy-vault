import { readFile } from "node:fs/promises";
import { z } from "zod";
import { connectLocalDatabase } from "../../database/connection.server.ts";
import {
  pendingRetentionPolicy,
  retentionCategories,
  type RetentionPolicy,
} from "../../src/lib/privacy/retention.ts";
import { previewRetention } from "../../src/lib/privacy/preview.server.ts";
const rule = z
  .object({
    status: z.enum(["pending", "approved"]),
    days: z.number().int().positive().max(36500).nullable(),
    approvalReference: z.string().min(1).max(200).nullable(),
    legalHold: z.enum(["unresolved", "clear", "held"]),
    immutable: z.boolean(),
  })
  .strict();
const policySchema = z
  .object({
    version: z.string().min(1).max(100),
    rules: z
      .object(Object.fromEntries(retentionCategories.map((category) => [category, rule])))
      .strict(),
  })
  .strict();
const path = process.env["CAPE_RETENTION_POLICY_FILE"];
const policy = path
  ? (policySchema.parse(JSON.parse(await readFile(path, "utf8"))) as RetentionPolicy)
  : pendingRetentionPolicy;
// A supplied policy cannot weaken immutable evidence categories.
for (const category of ["reviewHistory", "auditEvidence", "submissionVersions"] as const)
  policy.rules[category].immutable = true;
const owner = await connectLocalDatabase();
try {
  console.log(JSON.stringify(await previewRetention(owner.client, policy)));
} finally {
  await owner.close();
}
