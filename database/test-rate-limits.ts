// Test isolation only. Never imported by application/operator worker code.
import { createHmac } from "node:crypto";
import type { Sql } from "postgres";
import type { LimitPurpose } from "../src/lib/security/rate-limit.server.ts";
export async function expireFixtureLimits(
  owner: Sql,
  secret: string,
  purposes: LimitPurpose[],
  identities: string[],
) {
  const subjects = [
    "unknown-peer",
    "127.0.0.1",
    "::1",
    ...identities.map((id) => `identity:${id}`),
  ];
  const keys = purposes.flatMap((p) =>
    subjects.map(
      (subject) => p + ":" + createHmac("sha256", secret).update(`${p}:${subject}`).digest("hex"),
    ),
  );
  await owner`update app.rate_limits set expires_at=now()-interval '1 second' where key=any(${keys})`;
}
