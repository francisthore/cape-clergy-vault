import { createFileRoute } from "@tanstack/react-router";
import { AccessManagement } from "@/components/administration/AccessManagement";
export const Route = createFileRoute("/admin/access")({ component: AccessManagement });
