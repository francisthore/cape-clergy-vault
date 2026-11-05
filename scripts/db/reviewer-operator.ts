import { createInterface } from "node:readline/promises";
import { connectLocalDatabase } from "../../database/connection.server.ts";
import { createInvitationProof } from "../../src/lib/reviews/tokens.server.ts";
const [action, identity, subject] = process.argv.slice(2);
if (
  !process.stdin.isTTY ||
  !process.stdout.isTTY ||
  !action ||
  !identity ||
  !["invite", "cancel-invitation", "revoke-reviewer", "assign", "revoke-assignment"].includes(
    action,
  ) ||
  process.argv.length !==
    (["assign", "cancel-invitation", "revoke-assignment"].includes(action) ? 5 : 4) ||
  (subject && !/^[0-9a-f-]{36}$/.test(subject))
)
  throw Error(
    "Use reviewer-operator invite|revoke-reviewer EXACT_ID or assign|revoke-assignment|cancel-invitation EXACT_ID EXACT_SUBJECT_UUID in an interactive trusted terminal",
  );
const owner = await connectLocalDatabase(),
  terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const [target] = await owner.client`select u.id,u.email,u.email_verified,p.approval_status,
 exists(select 1 from app.role_assignments r where r.user_id=u.id and r.role='clergy' and r.revoked_at is null) as clergy,
 exists(select 1 from app.role_assignments r where r.user_id=u.id and r.role='reviewer' and r.revoked_at is null) as reviewer
 from auth.users u join app.clergy_profiles p on p.user_id=u.id where u.id=${identity}`;
  if (!target) throw Error("Exact registered identity not found");
  console.log(target);
  let revision: number | null = null;
  if (action === "assign") {
    const [s] =
      await owner.client`select id,title,status,revision,owner_id,confidential from app.submissions where id=${subject!}`;
    if (!s) throw Error("Exact submission not found");
    console.log(s);
    revision = Number(s["revision"]);
  }
  if (action === "cancel-invitation")
    console.log(
      await owner.client`select id,state,expires_at from app.reviewer_invitations where id=${subject!} and user_id=${identity}`,
    );
  if (action === "revoke-assignment")
    console.log(
      await owner.client`select id,submission_id,revision,status from app.reviewer_assignments where id=${subject!} and reviewer_id=${identity}`,
    );
  const required = `${action.toUpperCase()} ${identity}${subject ? " " + subject : ""}${action === "assign" ? " REVISION " + revision : ""}`;
  const confirmation = await terminal.question(`Type ${required}: `);
  if (confirmation !== required) throw Error("Confirmation mismatch");
  const proof =
    action === "invite"
      ? createInvitationProof(process.env["BETTER_AUTH_SECRET"] ?? "", identity)
      : null;
  const [r] =
    await owner.client`select app.reviewer_operator(${action},${identity},${subject ?? null},${proof?.digest ?? null},${proof?.sealed ?? null},${confirmation},${revision}) as id`;
  console.log("Operator change recorded. Reference:", r?.["id"] ?? "identity");
} catch {
  console.error(
    "Reviewer operator action failed. Check eligibility, exact IDs, state and confirmation. No token is printed.",
  );
  process.exitCode = 1;
} finally {
  terminal.close();
  await owner.close();
}
