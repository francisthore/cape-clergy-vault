import { createFileRoute } from "@tanstack/react-router";
import { ReviewerDetail } from "@/components/reviews/ReviewerWorkspace";
export const Route = createFileRoute("/reviewer/submissions/$id")({ component: Page });
function Page() {
  const { id } = Route.useParams();
  return <ReviewerDetail key={id} id={id} />;
}
