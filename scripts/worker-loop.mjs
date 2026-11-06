// Proposed supervisor entrypoint. Environment must contain only this worker's
// credential/configuration. No env files or owner connection are loaded here.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
const paths = {
  scanner: "scripts/db/document-scans.ts",
  approval: "scripts/db/approval-notifications.ts",
  reviewer: "scripts/db/reviewer-notifications.ts",
};
const kind = process.argv[2];
if (!Object.hasOwn(paths, kind)) throw Error("Choose scanner, approval or reviewer");
let stopping = false,
  child,
  timer,
  wake;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopping = true;
    clearTimeout(timer);
    wake?.();
    // Let current batch finish; interrupted work remains recoverable by lease.
    if (child) {
      const deadline = setTimeout(() => child?.kill("SIGTERM"), 190000);
      deadline.unref();
    }
  });
let failures = 0;
while (!stopping) {
  const correlationId = randomUUID();
  const code = await new Promise((resolve) => {
    child = spawn(process.execPath, [paths[kind]], { stdio: "inherit", env: process.env });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
  child = undefined;
  failures = code === 0 ? 0 : failures + 1;
  console.log(
    JSON.stringify({
      event: "worker.cycle",
      kind,
      correlationId,
      exit: code,
      consecutiveFailures: failures,
      alert: failures >= 3,
    }),
  );
  if (!stopping)
    await new Promise((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, 60000 + Math.floor(Math.random() * 5000));
    });
}
