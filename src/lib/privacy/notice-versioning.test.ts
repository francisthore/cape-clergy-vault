// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { registrationNotice } from "./notice";
import { privacyNoticeV1Draft, privacyNoticeV1DraftSectionIds } from "./notice-v1-draft";

// The database accepts exactly this identifier for registration (app.provision_clergy) and for
// the consent functions and policy (migrations 0035 and 0037). Changing it needs a reviewed
// migration, so the test pins it.
const acknowledgedRevision = "repository-v1-proposed-2026-11-16";
// SHA-256 of the active, acknowledged notice content. A change here means the text that users
// acknowledged has changed and must be handled as a new revision, never an edit in place.
const activeNoticeFingerprint = "5dc457850c8463d6e5c39730ec55259a1d9962dfcca18dc4d1ff7d7e134391ff";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

describe("privacy notice versioning", () => {
  it("keeps the acknowledged revision identifier and text unchanged", () => {
    expect(registrationNotice.version).toBe(acknowledgedRevision);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(registrationNotice))
      .digest("hex");
    expect(fingerprint).toBe(activeNoticeFingerprint);
  });

  it("keeps the proposed draft separate from the acknowledged revision", () => {
    expect(privacyNoticeV1Draft.identifier).not.toBe(registrationNotice.version);
    expect(privacyNoticeV1Draft.identifier).toMatch(/^repository-v1-draft-\d{4}-\d{2}-\d{2}$/);
    expect(privacyNoticeV1Draft.active).toBe(false);
    expect(privacyNoticeV1Draft.status).toBe("draft-not-approved");
  });

  it("states that the draft is not in force and carries the pre-launch warning", () => {
    expect(privacyNoticeV1Draft.warning).toContain("Not approved and not in force");
    expect(privacyNoticeV1Draft.warning).toContain("synthetic information");
  });

  it("contains the twelve required sections in order", () => {
    expect(privacyNoticeV1DraftSectionIds).toHaveLength(12);
    privacyNoticeV1Draft.sections.forEach((section, index) => {
      expect(section.heading.startsWith(`${index + 1}. `)).toBe(true);
      expect(section.paragraphs.length).toBeGreaterThan(0);
    });
  });

  it("leaves responsible-party and approval facts as visible placeholders", () => {
    const text = JSON.stringify(privacyNoticeV1Draft);
    for (const placeholder of [
      "Confirmed responsible party",
      "Information Officer",
      "Privacy contact email",
      "Registered or physical address",
      "Lawful basis and special personal information",
      "Retention periods for each category",
    ]) {
      expect(text).toContain(placeholder);
    }
    expect(text).toMatch(/\[[^\]]*awaiting[^\]]*\]/);
  });

  it("makes no compliance, guarantee, invented approval or fixed-deletion claim", () => {
    const text = JSON.stringify(privacyNoticeV1Draft).toLowerCase();
    for (const phrase of [
      "fully compliant",
      "popia compliant",
      "guarantee",
      "never shared",
      "30-day",
      "90-day",
      "approved by the diocese",
      "legally approved",
      "independently verified by",
    ]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("attributes Bouncer's location and retention statements to the provider", () => {
    const text = JSON.stringify(privacyNoticeV1Draft);
    expect(text).toContain("Bouncer's published privacy policy");
    expect(text).toContain("Mumbai (ap-south-1)");
    expect(text).toContain("deleted within 24 hours");
    expect(text).toContain("not independently verified");
    expect(text).toContain("Confidential PDFs are not to be sent to an external scanner");
  });

  it("covers the special personal information and transfer rules", () => {
    const text = JSON.stringify(privacyNoticeV1Draft);
    expect(text).toContain("special personal information (section 26)");
    expect(text).toContain("section 72");
    expect(text).toContain("Information Regulator");
    expect(text).toContain("passwords are not intentionally stored in plain text");
  });

  it("does not treat the checkbox as blanket consent", () => {
    const text = JSON.stringify(privacyNoticeV1Draft);
    expect(text).toContain("It is not blanket consent to every type of processing");
  });

  it("keeps the Markdown review copy aligned with the structured draft", () => {
    const markdown = readFileSync(join(repoRoot, "docs", "privacy-notice-v1-draft.md"), "utf8");
    for (const section of privacyNoticeV1Draft.sections) {
      expect(markdown).toContain(`## ${section.heading}`);
      for (const paragraph of section.paragraphs) {
        expect(markdown).toContain(paragraph);
      }
    }
  });
});
