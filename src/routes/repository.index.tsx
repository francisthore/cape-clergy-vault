import { createFileRoute } from "@tanstack/react-router";
import { SubmissionList } from "@/components/submissions/SubmissionList";
export const Route = createFileRoute("/repository/")({
  component: () => <SubmissionList repository />,
});
