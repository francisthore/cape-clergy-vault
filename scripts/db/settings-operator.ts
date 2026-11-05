import { createInterface } from "node:readline/promises";
import { connectLocalDatabase } from "../../database/connection.server.ts";
const [action, value] = process.argv.slice(2);
if (
  !process.stdin.isTTY ||
  process.argv.length !== 4 ||
  !value ||
  !["grant", "revoke", "authorize-domain"].includes(action ?? "")
)
  throw Error(
    "Use settings-operator.ts grant|revoke EXACT_ID or authorize-domain DOMAIN in a trusted interactive terminal",
  );
const owner = await connectLocalDatabase();
const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  if (action === "authorize-domain") {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(value)) throw Error("Invalid domain");
    console.log(
      "Independently inspect this exact domain in the provider console before authorizing. This command does not check Resend or alter DNS.",
    );
    const [sender] =
      await owner.client`select from_email from app.email_settings where sending_domain=${value}`;
    if (sender)
      console.log("Confirm this exact sender before authorizing live sends:", sender["from_email"]);
    const required = `AUTHORIZE VERIFIED DOMAIN ${value}${sender ? " SENDER " + String(sender["from_email"]) : ""}`;
    const confirmation = await terminal.question(`Type ${required}: `);
    if (confirmation !== required) throw Error("Confirmation mismatch");
    await owner.client.begin(async (tx) => {
      await tx`insert into app.email_domains(domain,authorized_at) values(${value},now()) on conflict(domain) do update set authorized_at=now()`;
      await tx`insert into app.audit_events(action,outcome) values('settings.email.domain_operator_authorized','ok')`;
    });
  } else {
    const [identity] =
      await owner.client`select u.id,u.email,u.email_verified,p.approval_status from auth.users u join app.clergy_profiles p on p.user_id=u.id where u.id=${value}`;
    if (!identity) throw Error("Identity not found");
    console.log(identity);
    const required =
      action === "grant" ? `GRANT SETTINGS MANAGER ${value}` : `REVOKE SETTINGS MANAGER ${value}`;
    const confirmation = await terminal.question(`Type ${required}: `);
    if (confirmation !== required) throw Error("Confirmation mismatch");
    if (action === "grant")
      await owner.client`select app.authorize_settings_manager(${value},${confirmation})`;
    else
      await owner.client.begin(async (tx) => {
        await tx`update app.settings_managers set revoked_at=now() where user_id=${value} and revoked_at is null`;
        await tx`insert into app.audit_events(target_user_id,action,outcome) values(${value},'settings.manager.operator_revoke','ok')`;
      });
  }
  console.log("Operator change recorded.");
} finally {
  terminal.close();
  await owner.close();
}
