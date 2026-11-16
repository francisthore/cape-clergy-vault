import { createFileRoute } from "@tanstack/react-router";
import { Intake } from "@/components/administration/Intake";
export const Route = createFileRoute("/admin/intake")({ component: Intake });
