import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfflineComposer } from "@/components/OfflineComposer";
import { ConversationMute } from "@/components/ConversationMute";
import { chatQueryOptions } from "@/lib/chat-query";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "Private chat — TEFT Repository" },
      {
        name: "description",
        content: "Private conversations between clergy and authorised TEFT reviewers.",
      },
      { property: "og:title", content: "Private chat — TEFT Repository" },
      {
        property: "og:description",
        content: "Private conversations with Theological Education Formation and Training.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(chatQueryOptions),
  component: Chat,
});

function Chat() {
  const { data, error } = useSuspenseQuery(chatQueryOptions);
  const [selected, setSelected] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const owners = [...new Set(data.messages.map((m) => m.owner_id))];
  const ownerId = data.admin
    ? selected && owners.includes(selected)
      ? selected
      : owners[0]
    : data.userId;
  const messages = data.messages.filter((m) => m.owner_id === ownerId);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, ownerId]);

  if (error)
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <p role="alert">Chat is unavailable. Please refresh or sign in again.</p>
      </main>
    );
  if (!data.consented)
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <h1 className="text-3xl text-primary">POPIA acknowledgement</h1>
        <p className="mt-4">Please acknowledge the updated notice before opening private chat.</p>
        <Button asChild className="mt-6">
          <Link to="/dashboard">Review POPIA notice</Link>
        </Button>
      </main>
    );

  const person = data.people.find((p) => p.id === ownerId);
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center gap-3">
        <MessageCircle className="size-7 text-primary" />
        <h1 className="text-4xl font-semibold text-primary">TEFT chat</h1>
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Bell className="size-4 shrink-0" />
        Push notifications are not connected yet.
      </p>
      <Button asChild variant="ghost" size="sm" className="mt-2">
        <Link to="/offline">Offline drafts</Link>
      </Button>
      <div className={`mt-8 grid gap-6 ${data.admin ? "md:grid-cols-[240px_minmax(0,1fr)]" : ""}`}>
        {data.admin && (
          <aside className="min-w-0">
            <h2 className="text-xl">Conversations</h2>
            <div className="mt-4 flex flex-col gap-2">
              {owners.map((id) => {
                const p = data.people.find((entry) => entry.id === id);
                return (
                  <Button
                    key={id}
                    variant={id === ownerId ? "secondary" : "ghost"}
                    className="h-auto justify-start whitespace-normal py-3 text-left"
                    onClick={() => setSelected(id)}
                  >
                    <span>
                      <span className="block">
                        {p ? `${p.title} ${p.full_name}` : "Clergy member"}
                      </span>
                      <span className="block text-xs text-muted-foreground">{p?.parish}</span>
                    </span>
                  </Button>
                );
              })}
              {!owners.length && (
                <p className="text-sm text-muted-foreground">No conversations yet.</p>
              )}
            </div>
          </aside>
        )}
        <section
          className="min-w-0 rounded-md border border-border bg-card"
          aria-label="Private conversation"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 className="min-w-0 text-xl">
              {data.admin && person
                ? `${person.title} ${person.full_name}`
                : "Theological Education Formation and Training (TEFT)"}
            </h2>
            {ownerId && <ConversationMute key={ownerId} ownerId={ownerId} userId={data.userId} />}
          </div>
          <div
            className="h-[420px] overflow-y-auto px-5 py-6"
            role="log"
            aria-label="Messages"
            aria-live="polite"
          >
            {!messages.length && (
              <p className="text-sm text-muted-foreground">
                {data.admin ? "Select a clergy conversation." : "No messages yet."}
              </p>
            )}
            <div className="space-y-5">
              {messages.map((m) => (
                <article
                  key={m.id}
                  className={`max-w-[90%] ${m.sender_id === data.userId ? "ml-auto border-l-2 border-primary pl-4" : "border-l-2 border-border pl-4"}`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <strong>
                      {m.sender_id === data.userId
                        ? "You"
                        : m.sender_id === m.owner_id
                          ? "Clergy"
                          : "TEFT reviewer"}
                    </strong>
                    <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString()}</time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                    {m.body}
                  </p>
                </article>
              ))}
            </div>
            <div ref={bottom} />
          </div>
          {ownerId && <OfflineComposer key={ownerId} ownerId={ownerId} userId={data.userId} />}
        </section>
      </div>
    </main>
  );
}
