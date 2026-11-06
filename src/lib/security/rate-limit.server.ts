import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Sql } from "postgres";
export type LimitPurpose =
  | "auth"
  | "login"
  | "register"
  | "mail"
  | "reset"
  | "invitation"
  | "admin"
  | "test_email"
  | "upload"
  | "search";
function canonicalIP(value: string | undefined) {
  if (!value || !isIP(value)) return undefined;
  if (value.startsWith("::ffff:") && isIP(value.slice(7)) === 4) return value.slice(7);
  return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
}
// Peer metadata is provided by the Node adapter, never a header. Missing metadata
// deliberately shares a bucket rather than trusting an attacker-supplied address.
export function clientAddress(
  request: Request,
  trusted = process.env["CAPE_TRUSTED_PROXY_IPS"] ?? "",
) {
  const metadata = request as Request & { context?: { clientAddress?: string }; ip?: string };
  const peer = canonicalIP(metadata.context?.clientAddress ?? metadata.ip);
  const proxies = trusted ? trusted.split(",").map((s) => canonicalIP(s.trim())) : [];
  if (proxies.some((p) => !p)) throw Error("Invalid trusted proxy configuration");
  if (!peer) return "unknown-peer";
  if (!proxies.includes(peer)) return peer;
  const forwarded = request.headers.get("x-forwarded-for");
  // Only a single overwrite by our directly connected trusted Nginx is supported.
  if (!forwarded || forwarded.includes(",") || forwarded !== forwarded.trim())
    return "invalid-proxy";
  return canonicalIP(forwarded) ?? "invalid-proxy";
}
export async function consumeLimit(
  client: Sql,
  secret: string,
  purpose: LimitPurpose,
  subject: string,
) {
  const digest = createHmac("sha256", secret).update(`${purpose}:${subject}`).digest("hex");
  const [row] = await client`select app.consume_rate_limit(${purpose},${digest}) as data`;
  if (!row?.["data"]) throw Error("Rate limiter unavailable");
  const result = row["data"] as { allowed: boolean; retryAfter: number };
  if (!result.allowed)
    console.info(
      JSON.stringify({ event: "security.rate_limited", purpose, correlationId: randomUUID() }),
    );
  return result;
}
export function limitedResponse(retryAfter: number) {
  return Response.json(
    { message: "Please wait before trying again." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(Math.max(1, Math.min(600, retryAfter))),
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
