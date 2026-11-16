import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/workspace";
import { AccountActions } from "@/components/administration/AccountActions";
export const Route = createFileRoute("/admin/")({
  component: () => (
    <main className="workspace-shell">
      <PageHeader
        eyebrow="TEFT · Cape Town"
        title="TEFT Administration"
        description="Your independently authorized operational workspaces."
      />
      <AccountActions administration />
    </main>
  ),
});
