// Prepared operator entry only. No service imports this module. Never invoked at startup.
import { createInterface } from "node:readline/promises";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectProductionDatabase } from "../../database/production.server.ts";
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
if (!["check", "migrate", "grants"].includes(action ?? ""))
  throw Error("Use check, migrate or grants");
const db = await connectProductionDatabase("operator");
try {
  const plan = await db.client.begin("read only", async (tx) => reviewedMigrationPlan(tx));
  console.log(JSON.stringify(plan));
  if (action !== "check") {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw Error("Interactive authorized operator required");
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (
        (await terminal.question(
          `Type ${action!.toUpperCase()} cape_clergy_vault to confirm separately authorized maintenance: `,
        )) !== `${action!.toUpperCase()} cape_clergy_vault`
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
    else {
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
