import { createInterface } from "node:readline/promises";
import { connectLocalDatabase } from "../../database/connection.server.ts";
const id = process.argv[2];
if (!id || process.argv.length !== 3 || !process.stdin.isTTY)
  throw new Error("Use bootstrap-approver.ts EXACT_ID from an interactive trusted local terminal");
const owner = await connectLocalDatabase();
const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const [account] =
    await owner.client`select u.id,u.email,u.email_verified,p.full_name,p.approval_status
    from auth.users u join app.clergy_profiles p on p.user_id=u.id where u.id=${id}`;
  if (!account?.["email_verified"])
    throw new Error("Existing verified registered identity required");
  console.log("Review the exact registered identity:", account);
  console.log("Permission: clergy registration approval only; no reviewer or system admin access.");
  const confirmation = await terminal.question(`Type GRANT APPROVER ${id} to confirm: `);
  await owner.client`select app.bootstrap_approver(${id},${confirmation})`;
  console.log("Initial approver established; immutable history and notification recorded.");
} finally {
  terminal.close();
  await owner.close();
}
