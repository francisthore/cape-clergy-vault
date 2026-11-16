import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { TransactionSql } from "postgres";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { connectLocalNotifications } from "./notifications.server.ts";
import { readDisposableManifest, assertDisposableDatabase } from "./disposable-phase41b.server.ts";
import { EmailService, TestEmailProvider } from "../src/lib/email/service.server.ts";
import { deliverReviewerNotifications } from "../src/lib/reviews/notifications.server.ts";
import {
  createInvitationProof,
  openInvitationProof,
  digestInvitation,
} from "../src/lib/reviews/tokens.server.ts";
import { createAuthService } from "../src/lib/auth/service.server.ts";
import { createAdministrationService } from "../src/lib/administration/service.server.ts";
import { hashPassword } from "better-auth/crypto";

test("Phase 4.2.2 disposable TEFT administration and exact-revision boundaries", async (t) => {
  const manifest = await readDisposableManifest();
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime(),
    worker = await connectLocalNotifications();
  await assertDisposableDatabase(owner.client, manifest);
  const prefix = "p422-" + randomUUID(),
    secret = "Synthetic-phase422-protected-secret-32-characters",
    origin = "http://localhost:3220";
  const provider = new TestEmailProvider(),
    email = new EmailService(provider, { from: "Capture <capture@example.invalid>", origin });
  const auth = createAuthService(runtime, email, { secret, baseURL: origin }),
    service = createAdministrationService(auth, origin, secret);
  const as = <T>(who: string, work: (tx: TransactionSql) => Promise<T>) =>
    runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${who},true)`;
      return work(tx);
    });
  const mailbox = (who: string) => who + "@example.invalid";
  const seed = async (label: string, status = "approved", roles: string[] = []) => {
    const who = prefix + "-" + label;
    await owner.client`insert into auth.users(id,name,email,email_verified) values(${who},'Synthetic clergy',${mailbox(who)},true)`;
    await owner.client`insert into app.clergy_profiles(user_id,full_name,title,parish,approval_status) values(${who},'Synthetic clergy','Rev.','Synthetic parish',${status})`;
    for (const role of ["clergy", ...roles])
      await owner.client`insert into app.role_assignments(user_id,role) values(${who},${role})`;
    await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},'repository-v1','repository','accepted')`;
    return who;
  };
  const caps = ["approver", "review_coordinator", "access_manager"],
    delegations = ["approver", "review_coordinator", "reviewer"];
  const reason = "Synthetic independently verified operator identity and authorization";
  const operator = (
    mode: string,
    who: string,
    confirmation = `${mode.toUpperCase()} ${who} CAPABILITIES ${caps.join(",")} DELEGATE ${delegations.join(",")}`,
  ) =>
    owner.client`select app.operator_administration(${mode},${who},${caps},${delegations},${reason},${confirmation})`;
  const access = (
    actor: string,
    who: string,
    cap: string,
    operation: string,
    request = randomUUID(),
    subject: string | null = null,
    digest: string | null = null,
    sealed: string | null = null,
  ) =>
    as(
      actor,
      (tx) =>
        tx`select app.manage_access(${operation},${who},${cap},${mailbox(who)},${operation.toUpperCase() + " " + who + " " + cap},${reason},${request},${subject},${digest},${sealed}) id`,
    );
  const draft = async (who: string, confidential = false) =>
    String(
      (
        await as(
          who,
          (tx) =>
            tx`select app.save_draft(null,0,'idea','Synthetic private title','General','A meaningful description for this synthetic theological proposal.',array[]::text[],${confidential}) id`,
        )
      )[0]!["id"],
    );
  const submit = (who: string, id: string, version = 1) =>
    as(who, (tx) => tx`select app.transition_submission(${id},${version},'submit')`);
  const notices = (id: string, kind: string) =>
    owner.client`select * from app.reviewer_notifications where submission_id=${id} and kind=${kind} order by created_at,id`;
  let coordinator = "",
    author = "",
    other = "",
    confidential = "",
    ordinary = "",
    assignment = "",
    cookies = "";
  try {
    coordinator = await seed("coordinator", "pending");
    author = await seed("author", "pending");
    other = await seed("other");
    const admin = await seed("admin", "approved", ["admin"]);
    await t.test(
      "unprivileged and admin identities receive no implicit coordinator/access/reviewer powers",
      async () => {
        for (const who of [author, other, admin]) {
          await assert.rejects(
            as(who, (tx) => tx`select app.coordination_inbox(1)`),
            { code: "42501" },
          );
          await assert.rejects(
            as(who, (tx) => tx`select app.access_identity(${coordinator})`),
            { code: "42501" },
          );
          assert.equal((await as(who, (tx) => tx`select app.is_reviewer() ok`))[0]!["ok"], false);
        }
        for (const sql of [
          "select * from app.operational_grants",
          "select * from app.administration_events",
          "select app.operator_administration('bootstrap','x',array['access_manager'],array[]::text[],'synthetic test authorization','x')",
        ])
          await assert.rejects(runtime.client.unsafe(sql), { code: "42501" });
      },
    );
    await t.test(
      "bootstrap requires exact operator confirmation, is one-time and does not activate reviewers",
      async () => {
        await assert.rejects(operator("bootstrap", coordinator, "wrong"), { code: "42501" });
        await operator("bootstrap", coordinator);
        await assert.rejects(operator("bootstrap", other), { code: "42501" });
        const [r] = await as(
          coordinator,
          (tx) =>
            tx`select app.is_approver() approver,app.has_operational('access_manager') manager,app.has_operational('review_coordinator') coordinator,app.is_reviewer() reviewer`,
        );
        assert.deepEqual(
          { ...r },
          { approver: true, manager: true, coordinator: true, reviewer: false },
        );
        assert.equal(
          (
            await owner.client`select operator from app.administration_events where target_id=${coordinator} limit 1`
          )[0]!["operator"],
          "cape_clergy_dev",
        );
        await assert.rejects(
          owner.client`update app.administration_events set reason='changed' where target_id=${coordinator}`,
        );
      },
    );
    await t.test(
      "clergy registration approval remains independently authorized and queues outcome",
      async () => {
        await as(
          coordinator,
          (tx) => tx`select app.decide_registration(${author},'approve','',${randomUUID()})`,
        );
        assert.equal(
          (
            await owner.client`select count(*)::int n from app.approval_notifications where user_id=${author} and kind='approved'`
          )[0]!["n"],
          1,
        );
      },
    );
    await t.test(
      "HTTP authority comes from a live Better Auth cookie; strict origin and bounded schema reject forgery",
      async () => {
        const password = "Synthetic phase422 credential passphrase",
          hash = await hashPassword(password);
        await owner.client`insert into auth.accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) values(${randomUUID()},${coordinator},'credential',${coordinator},${hash},now(),now())`;
        const response = await auth.handle(
          new Request(origin + "/api/auth/sign-in/email", {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify({ email: mailbox(coordinator), password }),
          }),
        );
        assert.equal(response.status, 200);
        cookies = response.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        const post = (headers: Record<string, string>, body: unknown) =>
          service.handle(
            new Request(origin + "/api/administration", {
              method: "POST",
              headers: { origin, "content-type": "application/json", ...headers },
              body: JSON.stringify(body),
            }),
          );
        const body = {
          action: "access",
          operation: "invite",
          identity: coordinator,
          capability: "reviewer",
          mailbox: mailbox(coordinator),
          confirmation: `INVITE ${coordinator} reviewer`,
          reason,
          requestId: randomUUID(),
        };
        assert.equal((await post({}, body)).status, 403);
        assert.equal(
          (await post({ cookie: cookies, origin: "http://untrusted.invalid" }, body)).status,
          403,
        );
        assert.equal(
          (await post({ cookie: cookies }, { ...body, actorId: coordinator })).status,
          400,
        );
        assert.equal((await post({ cookie: cookies }, body)).status, 200);
        assert.equal((await post({ cookie: cookies }, body)).status, 200);
        const [inv] =
          await owner.client`select n.sealed_token,i.token_digest,i.id,i.expires_at,i.created_at from app.reviewer_notifications n join app.reviewer_invitations i on i.id=n.invitation_id where i.user_id=${coordinator} and i.state='pending'`;
        assert.ok(inv);
        assert.equal(
          new Date(inv["expires_at"]).getTime() - new Date(inv["created_at"]).getTime(),
          3600000,
        );
        const proof = openInvitationProof(String(inv["sealed_token"]), secret, coordinator);
        assert.equal(digestInvitation(proof), inv["token_digest"]);
        assert.equal(
          (await as(coordinator, (tx) => tx`select app.is_reviewer() ok`))[0]!["ok"],
          false,
        );
        await assert.rejects(
          as(other, (tx) => tx`select app.accept_reviewer_invitation(${digestInvitation(proof)})`),
          { code: "22023" },
        );
        const results = await Promise.allSettled([
          as(
            coordinator,
            (tx) => tx`select app.accept_reviewer_invitation(${digestInvitation(proof)})`,
          ),
          as(
            coordinator,
            (tx) => tx`select app.accept_reviewer_invitation(${digestInvitation(proof)})`,
          ),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(
          (
            await owner.client`select count(*)::int n from app.role_assignments where user_id=${coordinator} and role='reviewer' and revoked_at is null`
          )[0]!["n"],
          1,
        );
        const lookup = await service.handle(
          new Request(
            origin + "/api/administration?view=identity&id=" + encodeURIComponent(coordinator),
            { headers: { cookie: cookies } },
          ),
        );
        const text = await lookup.text();
        assert.equal(lookup.status, 200);
        assert.ok(!text.includes(proof));
        assert.ok(!text.includes(String(inv["token_digest"])));
        assert.ok(!text.includes(String(inv["sealed_token"])));
      },
    );
    await t.test(
      "delegation limits prevent administrator/reviewer grants, self-grants and unconfirmed identity changes",
      async () => {
        await assert.rejects(access(coordinator, other, "settings_manager", "grant"), {
          code: "42501",
        });
        await assert.rejects(access(coordinator, other, "access_manager", "grant"), {
          code: "42501",
        });
        await assert.rejects(access(coordinator, other, "admin", "grant"), { code: "42501" });
        await assert.rejects(access(coordinator, other, "reviewer", "grant"), { code: "42501" });
        await assert.rejects(access(coordinator, coordinator, "approver", "grant"), {
          code: "42501",
        });
        await assert.rejects(
          as(
            coordinator,
            (tx) =>
              tx`select app.manage_access('grant',${other},'approver','wrong@example.invalid',${"GRANT " + other + " approver"},${reason},${randomUUID()})`,
          ),
          { code: "40001" },
        );
        const request = randomUUID();
        await access(coordinator, other, "approver", "grant", request);
        await access(coordinator, other, "approver", "grant", request);
        await assert.rejects(access(coordinator, other, "approver", "revoke", request), {
          code: "40001",
        });
        await access(coordinator, other, "approver", "revoke");
      },
    );
    await t.test(
      "UI-issued reviewer invitations remain mailbox-bound, cancellable and expiring",
      async () => {
        const candidate = await seed("candidate");
        let proof = createInvitationProof(secret, candidate);
        const invitation = String(
          (
            await access(
              coordinator,
              candidate,
              "reviewer",
              "invite",
              randomUUID(),
              null,
              proof.digest,
              proof.sealed,
            )
          )[0]!["id"],
        );
        await assert.rejects(
          access(
            coordinator,
            candidate,
            "reviewer",
            "invite",
            randomUUID(),
            null,
            proof.digest,
            proof.sealed,
          ),
          { code: "23505" },
        );
        await access(
          coordinator,
          candidate,
          "reviewer",
          "cancel-invitation",
          randomUUID(),
          invitation,
        );
        await assert.rejects(
          as(candidate, (tx) => tx`select app.accept_reviewer_invitation(${proof.digest})`),
          { code: "22023" },
        );
        proof = createInvitationProof(secret, candidate);
        await access(
          coordinator,
          candidate,
          "reviewer",
          "invite",
          randomUUID(),
          null,
          proof.digest,
          proof.sealed,
        );
        await owner.client`update auth.users set email=${candidate + "-changed@example.invalid"} where id=${candidate}`;
        await owner.client`update auth.users set email=${mailbox(candidate)} where id=${candidate}`;
        await assert.rejects(
          as(candidate, (tx) => tx`select app.accept_reviewer_invitation(${proof.digest})`),
          { code: "22023" },
        );
        proof = createInvitationProof(secret, candidate);
        const expired = String(
          (
            await access(
              coordinator,
              candidate,
              "reviewer",
              "invite",
              randomUUID(),
              null,
              proof.digest,
              proof.sealed,
            )
          )[0]!["id"],
        );
        // Test-only clock movement preserves the original one-hour constraint.
        await owner.client`update app.reviewer_invitations set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${expired}`;
        await assert.rejects(
          as(candidate, (tx) => tx`select app.accept_reviewer_invitation(${proof.digest})`),
          { code: "22023" },
        );
        const next = createInvitationProof(secret, candidate);
        await access(
          coordinator,
          candidate,
          "reviewer",
          "invite",
          randomUUID(),
          null,
          next.digest,
          next.sealed,
        );
        assert.equal(
          (await owner.client`select state from app.reviewer_invitations where id=${expired}`)[0]![
            "state"
          ],
          "revoked",
        );
        assert.equal(
          (await as(candidate, (tx) => tx`select app.is_reviewer() ok`))[0]!["ok"],
          false,
        );
      },
    );
    await t.test(
      "both confidentiality states submit, queue one acknowledgement/intake alert, and duplicates roll back",
      async () => {
        for (const privateResource of [false, true]) {
          const id = await draft(author, privateResource);
          await submit(author, id);
          if (privateResource) confidential = id;
          else ordinary = id;
          await assert.rejects(submit(author, id));
          assert.equal((await notices(id, "submission_received")).length, 1);
          assert.equal((await notices(id, "submission_intake")).length, 1);
        }
        const id = await draft(author);
        await assert.rejects(
          as(author, async (tx) => {
            await tx`select app.transition_submission(${id},1,'submit')`;
            throw Error("rollback");
          }),
        );
        assert.equal((await notices(id, "submission_received")).length, 0);
        const inbox = (
          await as(coordinator, (tx) => tx`select app.coordination_inbox(1) data`)
        )[0]!["data"];
        const item = inbox.items.find((r: { id: string }) => r.id === confidential);
        assert.equal(item.title, "Confidential resource");
        assert.ok(!JSON.stringify(item).includes("Synthetic private title"));
        assert.ok(!JSON.stringify(item).includes("description"));
        assert.equal(
          (
            await as(
              coordinator,
              (tx) => tx`select * from app.submissions where id=${confidential}`,
            )
          ).length,
          0,
        );
        assert.equal(
          (
            await as(
              coordinator,
              (tx) => tx`select * from app.review_decisions where submission_id=${confidential}`,
            )
          ).length,
          0,
        );
        await assert.rejects(
          as(
            other,
            (tx) =>
              tx`select app.coordinate_assignment(${ordinary},1,${coordinator},${randomUUID()})`,
          ),
          { code: "42501" },
        );
      },
    );
    await t.test(
      "durable captured notifications preserve payload/key on retry, recover leases and omit private metadata",
      async () => {
        for (const kind of ["submission_received", "submission_intake"]) {
          const id = String((await notices(ordinary, kind))[0]!["id"]);
          const lease = randomUUID();
          await worker.client`select app.claim_notification('reviewer',${lease},${id})`;
          assert.equal(await deliverReviewerNotifications(worker, email, origin, secret, 1, id), 0);
          await owner.client`update app.reviewer_notifications set available_at=now()-interval '1 second' where id=${id}`;
          provider.fail = true;
          assert.equal(await deliverReviewerNotifications(worker, email, origin, secret, 1, id), 0);
          const [failed] =
            await owner.client`select sender_from,recipient_email,attempts from app.reviewer_notifications where id=${id}`;
          assert.equal(failed!["attempts"], 2);
          await owner.client`update app.reviewer_notifications set available_at=now() where id=${id}`;
          provider.fail = false;
          assert.equal(await deliverReviewerNotifications(worker, email, origin, secret, 1, id), 1);
          const message = provider.messages.at(-1)!;
          assert.equal(message.key, "reviewer:" + id);
          assert.equal(message.from, failed!["sender_from"]);
          assert.equal(message.to, failed!["recipient_email"]);
          assert.ok(!message.text.includes("Synthetic private title"));
          assert.ok(!message.text.includes("meaningful description"));
          assert.ok(
            message.text.includes(
              kind === "submission_intake" ? "/admin/intake" : "/submissions/" + ordinary,
            ),
          );
          assert.equal(await deliverReviewerNotifications(worker, email, origin, secret, 1, id), 0);
        }
      },
    );
    await t.test(
      "explicit coordinator self-assignment on another author's work is revision-bound and cannot permit self-review",
      async () => {
        const own = await draft(coordinator);
        await submit(coordinator, own);
        await assert.rejects(
          as(
            coordinator,
            (tx) => tx`select app.coordinate_assignment(${own},1,${coordinator},${randomUUID()})`,
          ),
          { code: "40001" },
        );
        await assert.rejects(
          as(
            coordinator,
            (tx) =>
              tx`select app.coordinate_assignment(${confidential},2,${coordinator},${randomUUID()})`,
          ),
          { code: "40001" },
        );
        const emergency = await draft(author);
        await submit(author, emergency);
        await owner.client`select app.reviewer_operator('assign',${coordinator},${emergency},null,null,${"ASSIGN " + coordinator + " " + emergency + " REVISION 1"},1)`;
        assert.ok((await notices(emergency, "submission_intake"))[0]!["cancelled_at"]);
        const request = randomUUID();
        assignment = String(
          (
            await as(
              coordinator,
              (tx) =>
                tx`select app.coordinate_assignment(${confidential},1,${coordinator},${request}) id`,
            )
          )[0]!["id"],
        );
        assert.equal(
          (
            await as(
              coordinator,
              (tx) =>
                tx`select app.coordinate_assignment(${confidential},1,${coordinator},${request}) id`,
            )
          )[0]!["id"],
          assignment,
        );
        assert.equal(
          (
            await as(coordinator, (tx) => tx`select app.can_review_submission(${confidential}) ok`)
          )[0]!["ok"],
          true,
        );
        assert.equal(
          (
            await as(
              author,
              (tx) => tx`select app.author_assignment_status(${confidential}) status`,
            )
          )[0]!["status"],
          "assigned",
        );
        assert.ok((await notices(confidential, "submission_intake"))[0]!["cancelled_at"]);
        const notice = String((await notices(confidential, "review_assigned"))[0]!["id"]);
        assert.equal(
          await deliverReviewerNotifications(worker, email, origin, secret, 1, notice),
          1,
        );
        await as(
          coordinator,
          (tx) =>
            tx`select app.decide_review(${confidential},2,'under_review','','',${randomUUID()})`,
        );
        await as(
          coordinator,
          (tx) =>
            tx`select app.decide_review(${confidential},3,'returned','Please develop this idea with fuller theological sources.','PRIVATE SYNTHETIC REVIEWER NOTES',${randomUUID()})`,
        );
        const feedback = (
          await as(author, (tx) => tx`select app.author_review_feedback(${confidential}) data`)
        )[0]!["data"];
        assert.ok(!JSON.stringify(feedback).includes("PRIVATE SYNTHETIC"));
        assert.ok(JSON.stringify(feedback).includes("Please develop"));
        const returned = String((await notices(confidential, "submission_returned"))[0]!["id"]);
        assert.equal(
          await deliverReviewerNotifications(worker, email, origin, secret, 1, returned),
          1,
        );
        await as(author, (tx) => tx`select app.transition_submission(${confidential},4,'amend')`);
        assert.equal(
          (
            await as(coordinator, (tx) => tx`select app.can_review_submission(${confidential}) ok`)
          )[0]!["ok"],
          false,
        );
        await assert.rejects(
          as(
            coordinator,
            (tx) =>
              tx`select app.coordinate_assignment(${confidential},1,${coordinator},${randomUUID()})`,
          ),
          { code: "40001" },
        );
        await submit(author, confidential, 5);
        assert.equal((await notices(confidential, "submission_received")).length, 2);
        await as(
          coordinator,
          (tx) =>
            tx`select app.coordinate_assignment(${confidential},2,${coordinator},${randomUUID()})`,
        );
        await as(
          coordinator,
          (tx) =>
            tx`select app.decide_review(${confidential},6,'under_review','','',${randomUUID()})`,
        );
        await as(
          coordinator,
          (tx) =>
            tx`select app.decide_review(${confidential},7,'accepted','','The revised theological work now meets the review criteria.',${randomUUID()})`,
        );
        const accepted = String((await notices(confidential, "submission_accepted"))[0]!["id"]);
        assert.equal(
          await deliverReviewerNotifications(worker, email, origin, secret, 1, accepted),
          1,
        );
        assert.equal(
          (await as(other, (tx) => tx`select * from app.submissions where id=${confidential}`))
            .length,
          0,
        );
      },
    );
    await t.test(
      "assignment revocation, reviewer revocation and zero-coordinator evidence retain histories and fence delivery",
      async () => {
        const request = randomUUID();
        const active = String(
          (
            await as(
              coordinator,
              (tx) =>
                tx`select app.coordinate_assignment(${ordinary},1,${coordinator},${request}) id`,
            )
          )[0]!["id"],
        );
        const queued = String((await notices(ordinary, "review_assigned"))[0]!["id"]),
          lease = randomUUID();
        await worker.client`select app.claim_notification('reviewer',${lease},${queued})`;
        const revocation = randomUUID();
        await as(
          coordinator,
          (tx) => tx`select app.coordination_revoke_assignment(${active},${revocation})`,
        );
        await as(
          coordinator,
          (tx) => tx`select app.coordination_revoke_assignment(${active},${revocation})`,
        );
        assert.equal(
          (
            await worker.client`select app.check_notification('reviewer',${queued},${lease}) ok`
          )[0]!["ok"],
          false,
        );
        assert.equal(
          (await as(coordinator, (tx) => tx`select app.can_review_submission(${ordinary}) ok`))[0]![
            "ok"
          ],
          false,
        );
        // Another delegated manager revokes the coordinator's reviewer capability.
        await operator("recover", other);
        await access(other, coordinator, "reviewer", "revoke");
        assert.equal(
          (await as(coordinator, (tx) => tx`select app.is_reviewer() ok`))[0]!["ok"],
          false,
        );
        assert.equal(
          (
            await service.handle(
              new Request(origin + "/api/administration?view=intake", {
                headers: { cookie: cookies },
              }),
            )
          ).status,
          403,
        );
        assert.ok(
          (
            await owner.client`select count(*)::int n from app.review_decisions where submission_id=${confidential}`
          )[0]!["n"] >= 4,
        );
        await owner.client`update app.operational_grants set revoked_at=now() where capability='review_coordinator' and revoked_at is null`;
        const id = await draft(author);
        await submit(author, id);
        assert.equal((await notices(id, "submission_intake")).length, 0);
        assert.equal(
          (
            await owner.client`select count(*)::int n from app.audit_events where submission_id=${id} and action='submission.intake_no_recipients'`
          )[0]!["n"],
          1,
        );
        await assert.rejects(
          worker.client`select app.notification_eligible_before_phase422('reviewer',${randomUUID()})`,
          { code: "42501" },
        );
      },
    );
    await t.test(
      "break-glass revocation and fresh exact-identity recovery preserve evidence",
      async () => {
        await owner.client`select app.operator_administration('revoke',${other},array['access_manager'],array[]::text[],${reason},${"REVOKE " + other + " CAPABILITIES access_manager DELEGATE "})`;
        assert.equal(
          (await as(other, (tx) => tx`select app.has_operational('access_manager') ok`))[0]!["ok"],
          false,
        );
        await operator("recover", other);
        await owner.client`update app.role_assignments set revoked_at=now() where user_id=${other} and role='clergy' and revoked_at is null`;
        assert.equal(
          (await as(other, (tx) => tx`select app.has_operational('access_manager') ok`))[0]!["ok"],
          false,
        );
        await assert.rejects(
          as(other, (tx) => tx`select app.access_identity(${author})`),
          { code: "42501" },
        );
      },
    );
  } finally {
    await Promise.all([owner.close(), runtime.close(), worker.close()]);
  }
});
