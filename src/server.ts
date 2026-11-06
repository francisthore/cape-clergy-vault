import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const path = new URL(request.url).pathname;
      if (path === "/health/live" || path === "/health/ready") {
        if (request.method !== "GET" && request.method !== "HEAD")
          return new Response(null, { status: 405 });
        const { handleHealth } = await import("./lib/operations/health.server");
        return handleHealth(path);
      }
      if (path === "/admin/registrations" || path.startsWith("/admin/registrations/")) {
        const { authorizeApprovalPage } = await import("./lib/approvals/runtime.server");
        const denied = await authorizeApprovalPage(request.headers);
        if (denied) return denied;
      }
      if (
        (path === "/reviewer" || path.startsWith("/reviewer/")) &&
        path !== "/reviewer/invitation"
      ) {
        const { authorizeReviewerPage } = await import("./lib/reviews/runtime.server");
        const id = path.startsWith("/reviewer/submissions/")
          ? path.slice("/reviewer/submissions/".length)
          : undefined;
        if (id && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
          return new Response("Item unavailable", {
            status: 404,
            headers: { "Cache-Control": "no-store" },
          });
        const denied = await authorizeReviewerPage(request.headers, id);
        if (denied) return denied;
      }
      if (path === "/admin/settings/email") {
        const { authorizeSettingsPage } = await import("./lib/settings/runtime.server");
        const denied = await authorizeSettingsPage(request.headers);
        if (denied) return denied;
      }
      if (
        path === "/submissions" ||
        path.startsWith("/submissions/") ||
        path === "/repository" ||
        path.startsWith("/repository/")
      ) {
        const { authorizeSubmissionPage } = await import("./lib/submissions/runtime.server");
        const denied = await authorizeSubmissionPage(request.headers);
        if (denied) return denied;
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      if (
        ["/auth", "/account", "/documents"].includes(path) ||
        path.startsWith("/admin/") ||
        path.startsWith("/submissions") ||
        path.startsWith("/repository") ||
        path.startsWith("/reviewer")
      ) {
        const headers = new Headers(normalized.headers);
        headers.set("Cache-Control", "no-store");
        headers.set("Referrer-Policy", "no-referrer");
        headers.set("Vary", "Cookie");
        return new Response(normalized.body, { status: normalized.status, headers });
      }
      return normalized;
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
