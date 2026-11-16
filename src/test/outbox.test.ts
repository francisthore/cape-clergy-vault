import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLocalMessages,
  flushOutbox,
  localMessages,
  saveLocalMessage,
  type LocalMessage,
} from "@/lib/outbox";
const message: LocalMessage = {
  id: "message-1",
  userId: "clergy-a",
  ownerId: "clergy-a",
  body: "Please review my proposal",
  queued: true,
  createdAt: "2026-10-17T07:00:00Z",
};
beforeEach(() => clearLocalMessages());
describe("offline drafts and reconnect sending", () => {
  it("keeps a draft without sending until queued", async () => {
    await saveLocalMessage({ ...message, queued: false });
    let sent = 0;
    await flushOutbox(message.userId, async () => {
      sent++;
      return "sent";
    });
    expect(sent).toBe(0);
    expect((await localMessages(message.userId))[0]?.body).toBe(message.body);
  });
  it("sends only the current account's queued messages", async () => {
    await saveLocalMessage(message);
    await saveLocalMessage({ ...message, id: "other", userId: "clergy-b" });
    const delivered: string[] = [];
    await flushOutbox("clergy-a", async (m) => {
      delivered.push(m.id);
      return "sent";
    });
    expect(delivered).toEqual(["message-1"]);
    expect(await localMessages("clergy-a")).toHaveLength(0);
    expect(await localMessages("clergy-b")).toHaveLength(1);
  });
  it("retains the same message ID on failed connections", async () => {
    await saveLocalMessage(message);
    await flushOutbox(message.userId, async () => "retry");
    expect((await localMessages(message.userId))[0]?.id).toBe("message-1");
    await flushOutbox(message.userId, async () => "sent");
    expect(await localMessages(message.userId)).toHaveLength(0);
  });
  it("does not automatically retry denied messages", async () => {
    await saveLocalMessage(message);
    await flushOutbox(message.userId, async () => "blocked");
    let sent = 0;
    await flushOutbox(message.userId, async () => {
      sent++;
      return "sent";
    });
    expect(sent).toBe(0);
    expect((await localMessages(message.userId))[0]?.blocked).toBe(true);
  });
  it("clears saved messages on sign-out", async () => {
    await saveLocalMessage(message);
    await clearLocalMessages();
    expect(await localMessages(message.userId)).toHaveLength(0);
  });
});
