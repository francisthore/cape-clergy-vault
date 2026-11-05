import { createFileRoute } from "@tanstack/react-router";
import { handleSubmissions } from "@/lib/submissions/runtime.server";
export const Route = createFileRoute("/api/submissions")({
  server: {
    handlers: {
      GET: ({ request }) => handleSubmissions(request),
      POST: ({ request }) => handleSubmissions(request),
    },
  },
});
