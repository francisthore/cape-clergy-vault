import { createFileRoute } from "@tanstack/react-router";
import { handleDocuments } from "@/lib/documents/runtime.server";
export const Route = createFileRoute("/api/documents")({
  server: {
    handlers: {
      GET: ({ request }) => handleDocuments(request),
      POST: ({ request }) => handleDocuments(request),
    },
  },
});
