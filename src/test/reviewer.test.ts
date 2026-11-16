import { describe, it, expect } from "vitest";
import { isFreshOtp } from "@/lib/reviewer-rules";

describe("dean verification freshness", () => {
  it("accepts an emailed code used 5 minutes ago", () => {
    expect(isFreshOtp([{ method: "otp", timestamp: 1000 }], 1300)).toBe(true);
  });
  it("rejects a code older than 10 minutes", () => {
    expect(isFreshOtp([{ method: "otp", timestamp: 1000 }], 1601)).toBe(false);
  });
  it("rejects password-only sessions", () => {
    expect(isFreshOtp([{ method: "password", timestamp: 1000 }], 1001)).toBe(false);
  });
});

import { detectAlerts } from "@/lib/reviewer-rules";
const now = Date.parse("2026-10-16T04:00:00Z");
const ev = (min: number, action: string, outcome: string) => ({
  at: new Date(now - min * 60000).toISOString(),
  actor_id: "u1",
  actor_email: "a@x.org",
  action,
  outcome,
  submission_id: "s1",
});

describe("security alerts", () => {
  it("alerts on 3 denials within an hour", () => {
    expect(
      detectAlerts(
        [
          ev(1, "download", "denied"),
          ev(2, "download", "denied"),
          ev(3, "reviewer_verify", "denied"),
        ],
        now,
      )[0]?.kind,
    ).toBe("repeated_denials");
  });
  it("does not alert on 2 denials", () => {
    expect(
      detectAlerts([ev(1, "download", "denied"), ev(2, "download", "denied")], now),
    ).toHaveLength(0);
  });
  it("ignores denials older than an hour", () => {
    expect(
      detectAlerts([ev(61, "x", "denied"), ev(62, "x", "denied"), ev(63, "x", "denied")], now),
    ).toHaveLength(0);
  });
  it("alerts on 15 downloads within an hour", () => {
    expect(
      detectAlerts(
        Array.from({ length: 15 }, (_, i) => ev(i, "download", "ok")),
        now,
      )[0]?.kind,
    ).toBe("unusual_downloads");
  });
});
