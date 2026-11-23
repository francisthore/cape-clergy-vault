import { connectOperator } from "./operator-connection.ts";
import { configuredStorage } from "../../src/lib/documents/storage.server.ts";
import { storageInventory } from "../../src/lib/operations/inventory.server.ts";
if (process.argv.slice(2).some((arg) => arg !== "--verify"))
  throw Error("Use optional --verify only");
const owner = await connectOperator();
try {
  console.log(
    JSON.stringify(
      await storageInventory(
        owner.client,
        configuredStorage(true),
        process.env["CAPE_STORAGE_ROOT"] ?? ".local/storage",
        process.argv.includes("--verify"),
      ),
    ),
  );
} finally {
  await owner.close();
}
