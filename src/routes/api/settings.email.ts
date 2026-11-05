import { createFileRoute } from "@tanstack/react-router";
import { handleSettings } from "@/lib/settings/runtime.server";
export const Route = createFileRoute("/api/settings/email")({
  server: {
    handlers: {
      GET: ({ request }) => handleSettings(request),
      POST: ({ request }) => handleSettings(request),
    },
  },
});
