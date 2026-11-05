import { createFileRoute } from "@tanstack/react-router";
import { SubmissionForm } from "@/components/submissions/SubmissionForm";
export const Route = createFileRoute("/submissions/new")({
  component: () => (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <h1 className="text-3xl text-primary">Create a draft</h1>
      <a className="text-primary underline" href="/submissions">
        My submissions
      </a>
      <p>
        Save a draft to begin. You can attach PDFs after saving, or develop an idea without a file.
      </p>
      <SubmissionForm onSaved={(id) => window.location.assign(`/submissions/${id}`)} />
    </main>
  ),
});
