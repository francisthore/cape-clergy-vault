import { openDB, type DBSchema } from "idb";
import { chatMessageSchema } from "@/lib/chat";

export type LocalMessage = {
  id: string;
  userId: string;
  ownerId: string;
  body: string;
  queued: boolean;
  createdAt: string;
  blocked?: boolean;
};
interface MessageDB extends DBSchema {
  messages: { key: string; value: LocalMessage; indexes: { user: string } };
}
const db = () =>
  openDB<MessageDB>("teft-message-outbox", 1, {
    upgrade(database) {
      database.createObjectStore("messages", { keyPath: "id" }).createIndex("user", "userId");
    },
  });
export async function localMessages(userId: string) {
  return (await (await db()).getAllFromIndex("messages", "user", userId)).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}
export async function saveLocalMessage(message: LocalMessage) {
  await (await db()).put("messages", message);
  window.dispatchEvent(new Event("teft-outbox"));
}
export async function removeLocalMessage(id: string) {
  await (await db()).delete("messages", id);
  window.dispatchEvent(new Event("teft-outbox"));
}
export async function clearLocalMessages() {
  await (await db()).clear("messages");
  window.dispatchEvent(new Event("teft-outbox"));
}
export type DeliveryResult = "sent" | "retry" | "blocked";
export async function flushOutbox(
  userId: string,
  deliver: (message: LocalMessage) => Promise<DeliveryResult>,
) {
  for (const message of await localMessages(userId)) {
    if (!message.queued || message.blocked) continue;
    if (!chatMessageSchema.safeParse(message.body).success) {
      await saveLocalMessage({ ...message, blocked: true });
      continue;
    }
    const result = await deliver(message);
    if (result === "sent") await removeLocalMessage(message.id);
    else if (result === "blocked") await saveLocalMessage({ ...message, blocked: true });
    else break;
  }
}
