// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Resend } from "resend";
import {
  configuredEmail,
  EmailService,
  ResendEmailProvider,
  TestEmailProvider,
} from "./service.server";
import { emailTemplate } from "./templates.server";

afterEach(() => vi.restoreAllMocks());
describe("email infrastructure", () => {
  it("uses captured test delivery with both HTML and plain text; rejects foreign links", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    const provider = new TestEmailProvider();
    const service = new EmailService(provider, {
      from: "test@example.invalid",
      origin: "http://localhost:3000",
    });
    await service.send(
      "verification",
      "clergy@example.invalid",
      "http://localhost:3000/verify?token=secret&x=1",
    );
    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]?.html).toContain("&amp;x=1");
    expect(provider.messages[0]?.text).toContain("token=secret&x=1");
    await expect(
      service.send("reset", "clergy@example.invalid", "https://attacker.invalid/"),
    ).rejects.toThrow("Untrusted");
    expect(network).not.toHaveBeenCalled();
  });
  it("fails closed on incomplete production Resend configuration", () => {
    expect(() =>
      configuredEmail("https://vault.example.invalid", { NODE_ENV: "production" }),
    ).toThrow();
    expect(() =>
      configuredEmail("https://vault.example.invalid", {
        NODE_ENV: "production",
        CAPE_LOCAL_EMAIL_CAPTURE: "true",
      }),
    ).toThrow();
    expect(() =>
      configuredEmail("http://localhost:3000", {
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "fake",
      }),
    ).toThrow();
    expect(configuredEmail("http://localhost:3000", {})).toBeInstanceOf(EmailService);
  });
  it("retries transient Resend errors with an identical idempotency key; surfaces permanent errors", async () => {
    const client = new Resend("re_test_fake");
    const send = vi
      .spyOn(client.emails, "send")
      .mockResolvedValueOnce({
        data: null,
        error: { statusCode: 500, name: "application_error", message: "temporary" },
        headers: null,
      })
      .mockResolvedValueOnce({ data: { id: "captured" }, error: null, headers: null });
    const provider = new ResendEmailProvider(client);
    const message = {
      to: "test@example.invalid",
      from: "test@example.invalid",
      ...emailTemplate("reset", "http://localhost:3000/reset"),
      key: "stable-key",
    };
    await provider.send(message);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    send.mockResolvedValue({
      data: null,
      error: { statusCode: 422, name: "validation_error", message: "bad sender" },
      headers: null,
    });
    await expect(provider.send(message)).rejects.toThrow("EMAIL_DELIVERY_FAILED");
    expect(send).toHaveBeenCalledTimes(3);
  });
  it("has reusable future templates without activating approval workflows", () => {
    for (const kind of ["verification", "reset", "pending", "approved", "rejected"] as const) {
      const result = emailTemplate(kind, "https://vault.example.invalid/account");
      expect(result.html).toContain('lang="en"');
      expect(result.text).toContain("Anglican Diocese of Cape Town");
      expect(result.subject).not.toContain("undefined");
    }
  });
});
