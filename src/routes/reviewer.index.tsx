import { createFileRoute } from "@tanstack/react-router";
import { ReviewerWorkspace } from "@/components/reviews/ReviewerWorkspace";
export const Route = createFileRoute("/reviewer/")({ component: ReviewerWorkspace });
