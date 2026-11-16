import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isFreshOtp, SIGNED_URL_SECONDS, detectAlerts } from "./reviewer-rules";

type Claims = { email?: string; amr?: unknown } | undefined;
// Historical Supabase client: this isolated legacy module is read-only reference, not the active workflow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { supabase: any; userId: string };

type Entry = {
  action: string;
  outcome?: string;
  target_user?: string | null;
  submission_id?: string | null;
  detail?: string;
};

async function audit(ctx: { userId: string; claims?: Claims }, e: Entry) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("audit_log").insert({
    actor_id: ctx.userId,
    actor_email: ctx.claims?.email ?? null,
    outcome: "ok",
    ...e,
    detail: (e.detail ?? "").slice(0, 500),
  });
}

async function assertAdmin(ctx: Ctx & { claims?: Claims }, action: string) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) {
    await audit(ctx, { action, outcome: "denied", detail: "not a reviewer" });
    throw new Error("Forbidden");
  }
}

export const verifyDean = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const claims = context.claims as NonNullable<Claims>;
    const email = String(claims.email ?? "").toLowerCase();
    if (!email) throw new Error("No email on account");
    if (!isFreshOtp(claims.amr, Date.now() / 1000)) {
      await audit(context, {
        action: "reviewer_verify",
        outcome: "denied",
        detail: "no fresh email code",
      });
      throw new Error("Please confirm the emailed code first (within 10 minutes).");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    if (!u.user?.email_confirmed_at) {
      await audit(context, {
        action: "reviewer_verify",
        outcome: "denied",
        detail: "email unconfirmed",
      });
      throw new Error("Email address is not confirmed.");
    }
    const { data: inv } = await supabaseAdmin
      .from("reviewer_invites")
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (!inv || inv.used_by) {
      await audit(context, {
        action: "reviewer_verify",
        outcome: "denied",
        detail: "no open authorisation for this email",
      });
      throw new Error("This account has not been authorised as a reviewer.");
    }
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: context.userId, role: "admin" }, { onConflict: "user_id,role" });
    await supabaseAdmin
      .from("reviewer_invites")
      .update({ used_by: context.userId, used_at: new Date().toISOString() })
      .eq("email", email);
    await audit(context, {
      action: "role_granted",
      target_user: context.userId,
      detail: "reviewer verified via email code",
    });
    return { ok: true };
  });

export const listReviewers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context, "list_reviewers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: roles }, { data: invites }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin"),
      supabaseAdmin.from("reviewer_invites").select("email, used_by").is("used_by", null),
    ]);
    const active = await Promise.all(
      (roles ?? []).map(async (r) => {
        const { data } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
        return { userId: r.user_id, email: data.user?.email ?? "unknown" };
      }),
    );
    return { active, pending: (invites ?? []).map((i) => i.email) };
  });

export const inviteReviewer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { email: string }) => ({
    email: String(i.email).trim().toLowerCase().slice(0, 255),
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context, "reviewer_invite");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) throw new Error("Invalid email");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("reviewer_invites")
      .upsert({ email: data.email, used_by: null, used_at: null });
    await audit(context, { action: "reviewer_invite", detail: `authorised ${data.email}` });
    return { ok: true };
  });

export const revokeReviewer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { userId?: string; email?: string }) => i)
  .handler(async ({ data, context }) => {
    await assertAdmin(context, "role_revoke");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.email) {
      await audit(context, { action: "reviewer_invite_withdrawn", detail: data.email });
    }
    if (data.email)
      await supabaseAdmin.from("reviewer_invites").delete().eq("email", data.email.toLowerCase());
    if (data.userId) {
      if (data.userId === context.userId)
        throw new Error("Ask another reviewer to revoke your access.");
      // Role removal takes effect on the very next request: every policy checks the role live.
      await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", "admin");
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.userId);
      if (u.user?.email)
        await supabaseAdmin
          .from("reviewer_invites")
          .delete()
          .eq("email", u.user.email.toLowerCase());
      // End all sessions: a temporary ban revokes refresh tokens and outlasts current access tokens.
      await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "1h" });
      await audit(context, {
        action: "role_revoked",
        target_user: data.userId,
        detail: `revoked ${u.user?.email ?? ""}; sessions ended`,
      });
    }
    return { ok: true };
  });

export const getDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { submissionId: string }) => ({ submissionId: String(i.submissionId) }))
  .handler(async ({ data, context }) => {
    // Visibility is decided by the user's own row/storage permissions, re-checked on every request.
    const { data: sub } = await context.supabase
      .from("submissions")
      .select("id, file_path")
      .eq("id", data.submissionId)
      .maybeSingle();
    if (!sub?.file_path) {
      await audit(context, {
        action: "download",
        outcome: "denied",
        submission_id: data.submissionId,
        detail: "submission not visible",
      });
      throw new Error("You do not have access to this document.");
    }
    const { data: signed, error } = await context.supabase.storage
      .from("submissions")
      .createSignedUrl(sub.file_path, SIGNED_URL_SECONDS);
    if (error || !signed) {
      await audit(context, {
        action: "download",
        outcome: "denied",
        submission_id: sub.id,
        detail: "file access refused",
      });
      throw new Error("You do not have access to this document.");
    }
    await audit(context, { action: "download", submission_id: sub.id });
    return { url: signed.signedUrl };
  });

export const getAuditAndAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context, "view_audit");
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data } = await context.supabase
      .from("audit_log")
      .select("*")
      .gte("at", since)
      .order("at", { ascending: false })
      .limit(1000);
    const rows = data ?? [];
    return { recent: rows.slice(0, 100), alerts: detectAlerts(rows, Date.now()) };
  });
