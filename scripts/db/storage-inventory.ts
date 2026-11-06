import { connectLocalDatabase } from "../../database/connection.server.ts";
import { configuredStorage } from "../../src/lib/documents/storage.server.ts";
import { storageInventory } from "../../src/lib/operations/inventory.server.ts";
if (process.argv.slice(2).some((arg) => arg !== "--verify"))
  throw Error("Use optional --verify only");
const owner = await connectLocalDatabase();
try {
  console.log(
    JSON.stringify(
      await storageInventory(
        owner.client,
        configuredStorage(),
        process.env["CAPE_STORAGE_ROOT"] ?? ".local/storage",
        process.argv.includes("--verify"),
      ),
    ),
  );
} finally {
  await owner.close();
}
