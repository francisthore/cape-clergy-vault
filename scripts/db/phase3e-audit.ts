// Read-only. Phase 4.3: assertions come from database/security-contract.ts (reviewed contract),
// not from hardcoded counts. Nothing is deleted, rewritten, disabled or granted.
import { connectLocalDatabase } from "../../database/connection.server.ts";
import { runSecurityContract } from "../../database/security-contract.ts";

const owner = await connectLocalDatabase();
try {
  const result = await runSecurityContract(owner.client);
  for (const check of result.checks) console.log(`  ok  ${check}`);
  console.log(
    `PASS: ${result.migrations} migration hashes, ${result.rlsTables} RLS tables, reviewed grants/functions, enabled immutable triggers, no live disposable fixtures, preserved append-only evidence and browser artifacts scanned.`,
  );
} finally {
  await owner.close();
}
