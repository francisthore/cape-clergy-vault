import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectLocalDatabase } from "../../database/connection.server.ts";

const command = process.argv[2];
if (command !== "status" && command !== "migrate") throw new Error("Use status or migrate");
const connection = await connectLocalDatabase();
try {
  if (command === "migrate") {
    // Fixed path: never accept an arbitrary migration directory from CLI/env.
    await migrate(connection.db, {
      migrationsFolder: fileURLToPath(new URL("../../database/migrations", import.meta.url)),
      migrationsSchema: "cape_migrations",
    });
    console.log("Cape Clergy local migrations applied.");
  }
  const tables = await connection.client`
    select tablename from pg_tables where schemaname = 'app' order by tablename
  `;
  console.log("Isolation verified: 127.0.0.1:55432 / cape_clergy_vault_dev / cape_clergy_dev");
  console.log(
    `Application tables: ${tables.map((t) => t["tablename"]).join(", ") || "(not migrated)"}`,
  );
} finally {
  await connection.close();
}
