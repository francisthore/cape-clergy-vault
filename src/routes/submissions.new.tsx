import { PageHeader, WorkspaceSection } from "@/components/workspace";
import { createFileRoute } from "@tanstack/react-router";
import { SubmissionForm } from "@/components/submissions/SubmissionForm";
export const Route = createFileRoute("/submissions/new")({
  component: () => (
    <main className="workspace-shell !max-w-3xl">
      <PageHeader
        eyebrow="My submissions"
        title="Create a submission"
        description="Start with the resource details. You can save a draft at any time, then attach PDFs on the next screen."
      />
      <a className="text-primary underline" href="/submissions">
        My submissions
      </a>
      <p>
        Save your initial information first. The PDF selector appears on the next screen. You can
        also develop an idea without a file.
      </p>
      <WorkspaceSection title="Resource details">
        <SubmissionForm onSaved={(id) => window.location.assign(`/submissions/${id}`)} />
      </WorkspaceSection>
    </main>
  ),
});
