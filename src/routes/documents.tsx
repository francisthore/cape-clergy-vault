import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/documents")({
  component: () => (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <h1 className="text-3xl text-primary">Submission documents</h1>
      <p>Attach PDFs from your draft submission. Open an existing draft or create one to begin.</p>
      <a className="text-primary underline" href="/submissions">
        Open My Submissions
      </a>
    </main>
  ),
});
