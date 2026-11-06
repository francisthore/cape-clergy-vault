import { describe, it, expect } from "vitest";
import { healthResponse, readiness } from "./health.server";
import { pendingRetentionPolicy, retentionCategories, retentionCutoff } from "../privacy/retention";
const healthy = {
  ready: true,
  reachable: true,
  engineAvailable: true,
  signaturesAvailable: true,
  fresh: true,
  testObjectPassed: true,
};
describe("privacy-safe operational readiness", () => {
  it("distinguishes ready, scanner degraded, database unavailable and disk unavailable", async () => {
    const deps = {
      database: async () => undefined,
      scanner: async () => healthy,
      storage: async () => ({ freeBytes: 2 ** 30, freeInodes: 10000 }),
    };
    expect(await readiness(deps)).toBe("ready");
    expect(await readiness({ ...deps, scanner: async () => ({ ...healthy, ready: false }) })).toBe(
      "degraded",
    );
    expect(
      await readiness({
        ...deps,
        database: async () => {
          throw Error("secret connection");
        },
      }),
    ).toBe("unavailable");
    expect(
      await readiness({ ...deps, storage: async () => ({ freeBytes: 0, freeInodes: 0 }) }),
    ).toBe("unavailable");
  });
  it("public endpoint returns only a generic status with no cache", async () => {
    const r = healthResponse("degraded");
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ status: "degraded" });
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
  it("pending decisions, immutable history and legal holds never yield a disposal cutoff", () => {
    for (const c of retentionCategories)
      expect(retentionCutoff(pendingRetentionPolicy.rules[c])).toBeNull();
    const approved = {
      status: "approved" as const,
      days: 30,
      approvalReference: "hypothetical-fixture",
      legalHold: "clear" as const,
      immutable: false,
    };
    expect(retentionCutoff(approved)).toBeInstanceOf(Date);
    expect(retentionCutoff({ ...approved, legalHold: "held" })).toBeNull();
    expect(retentionCutoff({ ...approved, immutable: true })).toBeNull();
  });
});
