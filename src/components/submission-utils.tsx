import { toast } from "sonner";
import { getDownloadUrl } from "@/lib/reviewer.functions";
import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  accepted: "Accepted",
  returned: "Returned",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={
        status === "accepted" ? "default" : status === "returned" ? "destructive" : "secondary"
      }
    >
      {LABELS[status] ?? status}
    </Badge>
  );
}

export async function openFile(submissionId: string) {
  try {
    const { url } = await getDownloadUrl({ data: { submissionId } });
    window.open(url, "_blank", "noopener");
  } catch (e) {
    toast.error(e instanceof Error && e.message ? e.message : "Could not open file");
  }
}
