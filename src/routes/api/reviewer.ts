import { createFileRoute } from "@tanstack/react-router";
import { handleReviews } from "@/lib/reviews/runtime.server";
export const Route = createFileRoute("/api/reviewer")({
  server: {
    handlers: {
      GET: ({ request }) => handleReviews(request),
      POST: ({ request }) => handleReviews(request),
    },
  },
});
