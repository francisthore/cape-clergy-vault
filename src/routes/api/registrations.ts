import { createFileRoute } from "@tanstack/react-router";
import { handleApprovals } from "@/lib/approvals/runtime.server";
export const Route = createFileRoute("/api/registrations")({
  server: {
    handlers: {
      GET: ({ request }) => handleApprovals(request),
      POST: ({ request }) => handleApprovals(request),
    },
  },
});
