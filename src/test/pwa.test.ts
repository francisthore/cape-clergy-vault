import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAppWorker } from "@/lib/pwa-registration";
import { registerSW } from "virtual:pwa-register";
import { refusesAppWorker } from "@/lib/pwa-safety";
const published = {
  production: true,
  framed: false,
  hostname: "cape-clergy-vault.lovable.app",
  search: "",
};
describe("offline worker safety", () => {
  it("allows published apps only", () => {
    expect(refusesAppWorker(published)).toBe(false);
    expect(refusesAppWorker({ ...published, production: false })).toBe(true);
    expect(refusesAppWorker({ ...published, framed: true })).toBe(true);
  });
  it("blocks Lovable previews and supports the kill switch", () => {
    for (const hostname of [
      "id-preview--example.lovable.app",
      "preview--example.lovable.app",
      "lovableproject.com",
      "demo.lovableproject-dev.com",
      "beta.lovable.dev",
    ])
      expect(refusesAppWorker({ ...published, hostname })).toBe(true);
    expect(refusesAppWorker({ ...published, search: "?sw=off" })).toBe(true);
  });
});

describe("worker registration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("registers immediately in production when allowed", async () => {
    vi.stubEnv("PROD", true);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistrations: vi.fn() },
    });
    await registerAppWorker();
    expect(registerSW).toHaveBeenCalledWith({ immediate: true });
  });

  it("unregisters only the app worker when registration is blocked", async () => {
    vi.stubEnv("PROD", false);
    const unregister = vi.fn();
    const otherUnregister = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistrations: vi.fn().mockResolvedValue([
          { active: { scriptURL: "https://example.test/sw.js" }, unregister },
          { active: { scriptURL: "https://example.test/other.js" }, unregister: otherUnregister },
        ]),
      },
    });
    vi.mocked(registerSW).mockClear();
    await registerAppWorker();
    expect(unregister).toHaveBeenCalledOnce();
    expect(otherUnregister).not.toHaveBeenCalled();
    expect(registerSW).not.toHaveBeenCalled();
  });
});
