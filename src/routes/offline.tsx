import { createFileRoute, redirect } from "@tanstack/react-router";
// Legacy drafts remain on the device; chat/offline migration is deferred.
export const Route = createFileRoute("/offline")({
  beforeLoad: () => {
    throw redirect({ to: "/account" });
  },
});
