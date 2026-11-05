import { createFileRoute } from "@tanstack/react-router";
import { handleSubmissions } from "@/lib/submissions/runtime.server";
export const Route = createFileRoute("/api/repository")({
  server: { handlers: { GET: ({ request }) => handleSubmissions(request, true) } },
});
