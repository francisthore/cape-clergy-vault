import { useEffect, useRef, useState } from "react";
import { Send, Trash2, RefreshCw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { chatMessageSchema } from "@/lib/chat";
import {
  localMessages,
  saveLocalMessage,
  removeLocalMessage,
  type LocalMessage,
} from "@/lib/outbox";
import { sendQueuedMessages } from "@/lib/outbox-delivery";

export function OfflineComposer({ userId, ownerId }: { userId: string; ownerId: string }) {
  const [body, setBody] = useState("");
  const [items, setItems] = useState<LocalMessage[]>([]);
  const [online, setOnline] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const draftId = `draft:${userId}:${ownerId}`;
  const revision = useRef(0);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const rows = await localMessages(userId);
      if (active) setItems(rows.filter((m) => m.ownerId === ownerId && m.queued));
    };
    localMessages(userId)
      .then((rows) => {
        if (active) {
          setBody(rows.find((m) => m.id === draftId)?.body ?? "");
          setReady(true);
        }
      })
      .catch(() => toast.error("This browser cannot save offline drafts."));
    const network = () => setOnline(navigator.onLine);
    network();
    refresh().catch(() => {});
    window.addEventListener("teft-outbox", refresh);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    return () => {
      active = false;
      window.removeEventListener("teft-outbox", refresh);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, [userId, ownerId, draftId]);
  const change = (value: string) => {
    setBody(value);
    revision.current++;
    writes.current = writes.current
      .catch(() => {})
      .then(() =>
        value
          ? saveLocalMessage({
              id: draftId,
              userId,
              ownerId,
              body: value,
              queued: false,
              createdAt: new Date().toISOString(),
            })
          : removeLocalMessage(draftId),
      );
    writes.current.catch(() => toast.error("Draft could not be saved on this device."));
  };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = chatMessageSchema.safeParse(body);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid message");
      return;
    }
    setBusy(true);
    const version = revision.current;
    try {
      await writes.current;
      await saveLocalMessage({
        id: crypto.randomUUID(),
        userId,
        ownerId,
        body: parsed.data,
        queued: true,
        createdAt: new Date().toISOString(),
      });
      if (version === revision.current) {
        setBody("");
        await removeLocalMessage(draftId);
      }
      await sendQueuedMessages();
    } catch {
      toast.error("Message could not be saved. Your draft is still available.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-t border-border p-4">
      {!online && (
        <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <WifiOff className="size-4" />
          Offline · drafts saved on this device
        </p>
      )}
      {items.length > 0 && (
        <ul aria-label="Queued messages" className="mb-4 space-y-3">
          {items.map((item) => (
            <li key={item.id} className="border-l-2 border-border pl-3">
              <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                {item.body}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {item.blocked
                    ? "Not sent · access needs checking"
                    : "Queued · waiting to reconnect"}
                </span>
                {item.blocked && (
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Retry message"
                    aria-label="Retry message"
                    onClick={async () => {
                      await saveLocalMessage({ ...item, blocked: false });
                      await sendQueuedMessages();
                    }}
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  title="Discard queued message"
                  aria-label="Discard queued message"
                  onClick={() => removeLocalMessage(item.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send}>
        <Textarea
          aria-label="Message"
          placeholder="Your message…"
          value={body}
          onChange={(e) => change(e.target.value)}
          maxLength={4000}
          rows={3}
          disabled={!ready || busy}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {body.length} / 4,000{body ? " · Draft on this device" : ""}
          </span>
          <Button type="submit" disabled={!ready || busy || !body.trim()}>
            <Send className="size-4" />
            {busy ? "Saving…" : online ? "Send" : "Queue message"}
          </Button>
        </div>
      </form>
    </div>
  );
}
