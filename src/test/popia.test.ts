import { describe, it, expect } from "vitest";
import { registerSchema, fileAllowed } from "@/lib/popia";

const base = {
  title: "Rev.",
  full_name: "Thabo Mokoena",
  parish: "St George's",
  email: "t@x.org",
  password: "longpass1",
};

describe("POPIA registration", () => {
  it("rejects registration without POPIA acknowledgement", () => {
    expect(registerSchema.safeParse({ ...base, popia: false }).success).toBe(false);
  });
  it("accepts registration with POPIA acknowledgement", () => {
    expect(registerSchema.safeParse({ ...base, popia: true }).success).toBe(true);
  });
});

describe("file limits", () => {
  it("rejects files over 25MB", () => {
    expect(fileAllowed("a.pdf", 26 * 1024 * 1024)).toBe(false);
  });
  it("rejects executables", () => {
    expect(fileAllowed("a.exe", 100)).toBe(false);
  });
});
