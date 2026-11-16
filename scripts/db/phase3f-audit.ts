// Read-only. Superset of the Phase 3E audit (the shared reviewed security contract covers scanner,
// notification and TEFT administration grants) plus expired-token retention reporting.
import assert from "node:assert/strict";
import { connectLocalDatabase } from "../../database/connection.server.ts";
import { runSecurityContract } from "../../database/security-contract.ts";

const owner = await connectLocalDatabase();
try {
  const result = await runSecurityContract(owner.client);
  for (const check of result.checks) console.log(`  ok  ${check}`);
  const [tokens] = await owner.client`select count(*)::int as retained_expired,
    count(*) filter(where expires_at>now())::int as active from auth.verifications`;
  assert.equal(tokens!["active"], 0, "No active test verification/reset records remain");
  console.log(
    `Retained ${tokens!["retained_expired"]} expired verification-digest rows; no unapproved retention deletion performed.`,
  );
  console.log(
    `PASS: ${result.migrations} migration hashes, ${result.rlsTables} RLS tables, scanner/notification/administration grants, enabled immutable triggers, fixture state, capture classification and browser artifacts.`,
  );
} finally {
  await owner.close();
}
