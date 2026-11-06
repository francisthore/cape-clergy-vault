import { describe, it, expect } from "vitest";
import { clientAddress, limitedResponse } from "./rate-limit.server";
function request(peer?: string, forwarded?: string) {
  return Object.assign(
    new Request("http://localhost/", {
      headers: forwarded
        ? { "x-forwarded-for": forwarded, "x-real-ip": "192.0.2.99", forwarded: "for=192.0.2.99" }
        : {},
    }),
    { context: { clientAddress: peer } },
  );
}
describe("trusted proxy boundary", () => {
  it("ignores forged headers on direct and unknown peers", () => {
    expect(clientAddress(request("192.0.2.1", "198.51.100.1"), "127.0.0.1")).toBe("192.0.2.1");
    expect(clientAddress(request(undefined, "198.51.100.1"), "127.0.0.1")).toBe("unknown-peer");
  });
  it("accepts only one valid address from an explicit trusted peer", () => {
    expect(clientAddress(request("::ffff:127.0.0.1", "198.51.100.1"), "127.0.0.1")).toBe(
      "198.51.100.1",
    );
    for (const header of [undefined, "1.2.3.4, 5.6.7.8", "garbage", "1.2.3.4:80"])
      expect(clientAddress(request("127.0.0.1", header), "127.0.0.1")).toBe("invalid-proxy");
    expect(() => clientAddress(request("127.0.0.1"), "*")).toThrow();
  });
  it("canonicalizes IPv6 and bounds retry advice", () => {
    expect(clientAddress(request("2001:0db8::1"), "")).toBe("2001:db8::1");
    expect(limitedResponse(99999).headers.get("Retry-After")).toBe("600");
    expect(limitedResponse(1).status).toBe(429);
  });
});
