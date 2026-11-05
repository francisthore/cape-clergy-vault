import { createFileRoute, redirect } from "@tanstack/react-router";
// Legacy Supabase workflows are isolated until their later migration phases.
// No legacy child loader/component runs under the new Better Auth identity.
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: () => {
    throw redirect({ to: "/account" });
  },
});
