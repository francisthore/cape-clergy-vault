import { createFileRoute } from "@tanstack/react-router";
import { handleAdministration } from "@/lib/administration/runtime.server";
export const Route = createFileRoute("/api/administration")({
  server: {
    handlers: {
      GET: ({ request }) => handleAdministration(request),
      POST: ({ request }) => handleAdministration(request),
    },
  },
});
