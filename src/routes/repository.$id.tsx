import { createFileRoute } from "@tanstack/react-router";
import { SubmissionDetail } from "@/components/submissions/SubmissionDetail";
export const Route = createFileRoute("/repository/$id")({ component: Page });
function Page() {
  const { id } = Route.useParams();
  return <SubmissionDetail id={id} repository />;
}
