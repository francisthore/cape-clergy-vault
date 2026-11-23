// Prepared operator entry only. No service imports this module. Never invoked at startup.
import { createInterface } from "node:readline/promises";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  assertPilotContract,
  connectProductionDatabase,
} from "../../database/production.server.ts";
import {
  migrationFolder,
  productionGrants,
  reviewedMigrationPlan,
} from "../../database/migration-plan.server.ts";
import {
  auditMigrationLedger,
  auditRoles,
  auditRls,
  auditGrants,
  auditFunctions,
  auditImmutableTriggers,
} from "../../database/security-contract.ts";
const action = process.argv[2];
const policyAction = action === "approve-confidential" || action === "withdraw-confidential";
const reference = process.argv[3]?.trim();
if (!policyAction && !["check", "migrate", "grants"].includes(action ?? ""))
  throw Error("Choose a documented maintenance operation");
if (policyAction && (!reference || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(reference)))
  throw Error("Provide the restricted register record identifier, without personal details");
const db = await connectProductionDatabase("operator");
try {
  const plan = await db.client.begin("read only", async (tx) => reviewedMigrationPlan(tx));
  console.log(JSON.stringify(plan));
  if (action !== "check") {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw Error("Interactive authorized operator required");
    const confirmation = [
      action!.toUpperCase(),
      "cape_clergy_vault",
      ...(policyAction ? [reference] : []),
    ].join(" ");
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (
        (await terminal.question(
          `Type ${confirmation} to confirm separately authorized maintenance: `,
        )) !== confirmation
      )
        throw Error("Confirmation mismatch");
    } finally {
      terminal.close();
    }
    if (action === "migrate")
      await migrate(db.db, {
        migrationsFolder: migrationFolder,
        migrationsSchema: "cape_migrations",
      });
    else if (policyAction) {
      if (plan.pending.length) throw Error("Current release schema required");
      if (action === "approve-confidential") await assertPilotContract(db.client);
      await db.client.begin(async (tx) => {
        if (action === "approve-confidential") {
          await tx`insert into app.confidential_scan_approvals(reference) values(${reference!})`;
        } else {
          const rows = await tx`update app.confidential_scan_approvals set revoked_at=now()
            where reference=${reference!} and revoked_at is null returning reference`;
          if (!rows.length) throw Error("Active decision reference required");
        }
      });
    } else {
      if (plan.pending.length) throw Error("Migrations required before reviewed grants");
      await db.client.begin(async (tx) => tx.unsafe(await productionGrants()));
    }
  }
  const checks: string[] = [];
  await db.client`set default_transaction_read_only=on`;
  await auditMigrationLedger(db.client, checks);
  if (action === "migrate") {
    console.log(
      "Forward migration ledger verified. Reviewed grants and full check are still required; keep services stopped.",
    );
  } else {
    await auditRoles(db.client, checks);
    await auditRls(db.client, checks);
    await auditGrants(db.client, checks);
    await auditFunctions(db.client, checks);
    await auditImmutableTriggers(db.client, checks);
  }
  for (const check of checks) console.log(check);
} catch {
  console.error(
    "Production maintenance failed; inspect protected operator evidence without logging credentials.",
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
