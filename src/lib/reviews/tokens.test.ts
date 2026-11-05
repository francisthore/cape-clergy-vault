// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createInvitationProof, digestInvitation, openInvitationProof } from "./tokens.server";
describe("reviewer delivery proof envelopes", () => {
  const secret = "test-only-protected-secret-with-more-than-32-characters";
  it("uses independent random proof and nonce and stores a digest separately", () => {
    const first = createInvitationProof(secret, "identity-a"),
      second = createInvitationProof(secret, "identity-a");
    const token = openInvitationProof(first.sealed, secret, "identity-a");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(digestInvitation(token)).toBe(first.digest);
    expect(first.sealed.includes(token)).toBe(false);
    expect(first.digest).not.toBe(second.digest);
    expect(first.sealed.split(".")[1]).not.toBe(second.sealed.split(".")[1]);
  });
  it("authenticates the recipient identity and purpose-derived key", () => {
    const value = createInvitationProof(secret, "identity-a");
    expect(() => openInvitationProof(value.sealed, secret, "identity-b")).toThrow();
    expect(() =>
      openInvitationProof(
        value.sealed,
        "different-protected-test-secret-at-least-32-characters",
        "identity-a",
      ),
    ).toThrow();
  });
  it("rejects corrupt or unsupported envelopes", () => {
    const value = createInvitationProof(secret, "identity-a");
    const parts = value.sealed.split(".");
    parts[2] = Buffer.alloc(16).toString("base64url");
    expect(() => openInvitationProof(parts.join("."), secret, "identity-a")).toThrow();
    expect(() => openInvitationProof("v0.invalid", secret, "identity-a")).toThrow();
  });
  it("requires a protected secret of the existing auth minimum length", () => {
    expect(() => createInvitationProof("short", "identity-a")).toThrow();
  });
});
