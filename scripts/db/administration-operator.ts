import { createInterface } from "node:readline/promises";
import { connectLocalDatabase } from "../../database/connection.server.ts";
const [mode, identity, capabilities, delegated] = process.argv.slice(2);
if (
  process.argv.length !== 6 ||
  !["bootstrap", "recover", "revoke"].includes(mode ?? "") ||
  !identity ||
  !capabilities ||
  delegated === undefined ||
  !process.stdin.isTTY ||
  !process.stdout.isTTY
)
  throw Error(
    "Use administration-operator.ts bootstrap|recover|revoke EXACT_ID CAPABILITIES_COMMA_LIST DELEGATED_COMMA_LIST from a trusted interactive terminal. Use '-' for no delegations.",
  );
const caps = capabilities.split(","),
  delegations = delegated === "-" ? [] : delegated.split(",");
if (
  caps.some((c) => !["approver", "review_coordinator", "access_manager"].includes(c)) ||
  delegations.some(
    (c) => !["approver", "review_coordinator", "reviewer", "settings_manager"].includes(c),
  )
)
  throw Error("Unsupported explicit capability list");
const owner = await connectLocalDatabase();
const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const [account] =
    await owner.client`select u.id,u.email,u.email_verified,p.full_name,p.approval_status from auth.users u join app.clergy_profiles p on p.user_id=u.id where u.id=${identity}`;
  if (!account || (mode !== "revoke" && !account["email_verified"]))
    throw Error("Exact verified registered identity required");
  console.log("Independently verify this exact person, registered ID and mailbox:", account);
  console.log("Explicit capabilities:", caps, "Explicitly delegated management:", delegations);
  console.log(
    "This does not activate a reviewer. Initial bootstrap may approve this pending registered clergy identity. Recovery requires an already approved identity.",
  );
  const reason = await terminal.question(
    "Record independent identity verification and operator authorization evidence (20–1000 characters, no secrets): ",
  );
  const expected = `${mode!.toUpperCase()} ${identity} CAPABILITIES ${caps.join(",")} DELEGATE ${delegations.join(",")}`;
  const confirmation = await terminal.question(`Type ${expected} to confirm: `);
  await owner.client`select app.operator_administration(${mode!},${identity},${caps},${delegations},${reason},${confirmation})`;
  console.log(
    "Explicit administration operation committed with immutable operator evidence. Use the web interface for ordinary operations.",
  );
} finally {
  terminal.close();
  await owner.close();
}
