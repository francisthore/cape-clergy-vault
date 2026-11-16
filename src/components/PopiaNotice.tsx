import { POPIA_POINTS, POPIA_VERSION } from "@/lib/popia";

export function PopiaNotice() {
  return (
    <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-muted p-4 text-sm">
      <p className="font-semibold">POPIA notice (version {POPIA_VERSION})</p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
        {POPIA_POINTS.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}
