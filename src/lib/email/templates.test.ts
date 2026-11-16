// @vitest-environment node
import { describe, it, expect } from "vitest";
import { emailSpecs, emailTemplate, type EmailKind } from "./templates.server";

const kinds = Object.keys(emailSpecs) as EmailKind[];
const url = "https://vault.example.invalid/account";

describe("transactional email templates", () => {
  it("covers every current email kind, including the Phase 4.2.2 submission kinds", () => {
    expect(kinds.sort()).toEqual(
      [
        "approved",
        "pending",
        "reactivated",
        "registration_pending_alert",
        "rejected",
        "reset",
        "review_assigned",
        "reviewer_invitation",
        "submission_accepted",
        "submission_intake",
        "submission_received",
        "submission_returned",
        "suspended",
        "test",
        "verification",
      ].sort(),
    );
  });

  it.each(kinds)("%s renders a subject, HTML and plain text without placeholders", (kind) => {
    const result = emailTemplate(kind, url);
    expect(result.subject.length).toBeGreaterThan(8);
    expect(result.subject.length).toBeLessThan(90);
    for (const value of [result.subject, result.text, result.html]) {
      expect(value).not.toContain("undefined");
      expect(value).not.toContain("[object Object]");
    }
    expect(result.html.startsWith("<!doctype html>")).toBe(true);
    expect(result.html).toContain('lang="en"');
    expect(result.html).toContain('name="viewport"');
    expect(result.text).toContain(`${emailSpecs[kind].action}: ${url}`);
  });

  it.each(kinds)("%s keeps HTML and text semantically equivalent", (kind) => {
    const spec = emailSpecs[kind];
    const result = emailTemplate(kind, url);
    for (const paragraph of spec.paragraphs) {
      expect(result.text).toContain(paragraph);
      expect(result.html).toContain(paragraph.replace(/&/g, "&amp;").replace(/'/g, "&#39;"));
    }
    expect(result.html).toContain(spec.heading);
    expect(result.html).toContain(`href="${url}"`);
    expect(result.html).toContain(`>${url}<`);
  });

  it("uses only inline styles, no scripts, external stylesheets or tracking pixels", () => {
    for (const kind of kinds) {
      const { html } = emailTemplate(kind, url);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<link/i);
      expect(html).not.toMatch(/@import/i);
      expect(html).not.toMatch(/url\(/i);
      expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/i);
      // The only remote image is the Diocese crest, on the trusted application origin.
      const sources = [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]);
      expect(sources).toEqual(["https://vault.example.invalid/dct-crest-source.png"]);
    }
  });

  it("escapes interpolated links and keeps the full URL in the text fallback", () => {
    const hostile = 'https://vault.example.invalid/reset?token=a&b=1"><script>x</script>';
    const { html, text } = emailTemplate("reset", hostile);
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&amp;b=1");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
    expect(text).toContain(hostile);
  });

  it("states the one-hour expiry where the implementation enforces it", () => {
    for (const kind of ["verification", "reset", "reviewer_invitation"] as const) {
      expect(emailSpecs[kind].paragraphs.join(" ")).toContain("expires one hour");
    }
  });

  it("uses the agreed wording for the example notifications", () => {
    expect(emailTemplate("approved", url).subject).toBe(
      "Your clergy registration has been approved",
    );
    expect(emailTemplate("submission_received", url).subject).toBe(
      "Your resource has been received by TEFT",
    );
    expect(emailTemplate("submission_received", url).text).toContain("View my submission");
    expect(emailTemplate("submission_returned", url).subject).toBe(
      "An update on your theological submission",
    );
    expect(emailTemplate("submission_returned", url).text).toContain("View feedback");
  });

  it("keeps workflow states distinct: receipt, assignment and decision are not conflated", () => {
    expect(emailSpecs.submission_received.paragraphs.join(" ")).toContain(
      "awaiting the next stage",
    );
    expect(emailSpecs.review_assigned.paragraphs.join(" ")).toContain("assigned to you");
    expect(emailSpecs.submission_accepted.paragraphs.join(" ")).toContain("has accepted");
    expect(emailSpecs.submission_returned.paragraphs.join(" ")).toContain("returned");
  });

  it("keeps rejection and suspension neutral and free of internal reasons", () => {
    for (const kind of ["rejected", "suspended"] as const) {
      // Standard footers are excluded; only the message written for this notice is checked.
      const body = emailSpecs[kind].paragraphs.join(" ").toLowerCase();
      for (const term of ["reason", "because", "violation", "fraud", "note", "decision was"]) {
        expect(body).not.toContain(term);
      }
    }
  });

  it("does not leak submission, reviewer-note or secret material into any body", () => {
    for (const kind of kinds) {
      const { subject, text } = emailTemplate(kind, url);
      const combined = `${subject}\n${text}`.toLowerCase();
      for (const term of ["confidential", "private note", "reviewer note", "sealed", "digest"]) {
        expect(combined).not.toContain(term);
      }
      // Tokens appear only inside the link supplied by the worker, never as stated body text.
      expect(text.replace(url, "").toLowerCase()).not.toContain("token");
    }
  });

  it("uses the TEFT sign-off for ordinary correspondence and a neutral closing for security notices", () => {
    expect(emailTemplate("approved", url).text).toContain("Kind regards,\nThe TEFT Team");
    expect(emailTemplate("reset", url).text).not.toContain("Kind regards");
    expect(emailTemplate("verification", url).text).not.toContain("Kind regards");
  });

  it("avoids the robotic phrasing that was removed from ordinary user emails", () => {
    for (const kind of kinds) {
      const combined = emailTemplate(kind, url).text.toLowerCase();
      expect(combined).not.toContain("source of truth");
      expect(combined).not.toContain("authorized assignments");
      expect(combined).not.toContain("provider acceptance");
    }
  });
});
