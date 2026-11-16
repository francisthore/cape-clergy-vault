import { describe, expect, it } from "vitest";
import { chatMessageSchema } from "@/lib/chat";

describe("private chat messages", () => {
  it("rejects empty messages", () => {
    expect(chatMessageSchema.safeParse("   ").success).toBe(false);
  });
  it("accepts 4,000 characters but rejects 4,001", () => {
    expect(chatMessageSchema.safeParse("a".repeat(4000)).success).toBe(true);
    expect(chatMessageSchema.safeParse("a".repeat(4001)).success).toBe(false);
  });
});
