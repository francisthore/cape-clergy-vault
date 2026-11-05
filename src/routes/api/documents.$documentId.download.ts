import { createFileRoute } from "@tanstack/react-router";
import { handleDocuments } from "@/lib/documents/runtime.server";
export const Route = createFileRoute("/api/documents/$documentId/download")({
  server: {
    handlers: { GET: ({ request, params }) => handleDocuments(request, params.documentId) },
  },
});
