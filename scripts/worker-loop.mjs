import { supervise } from "./worker-supervisor.mjs";
// Local and host supervisor entrypoint. Environment must contain only this worker's
// credential/configuration. No env files or owner connection are loaded here.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const paths = {
  scanner: "scripts/db/document-scans.ts",
  approval: "scripts/db/approval-notifications.ts",
  reviewer: "scripts/db/reviewer-notifications.ts",
};
const kind = process.argv[2];
if (!Object.hasOwn(paths, kind)) throw Error("Choose scanner, approval or reviewer");
if (process.argv[3] !== "--locked") {
  const lockRoot = process.env.CAPE_WORKER_LOCK_ROOT ?? ".local";
  if (process.env.CAPE_DATABASE_MODE === "production" && lockRoot !== `/run/cape-vault/${kind}`)
    throw Error("Dedicated production worker lock directory required");
  mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  const lockArgs = [
    "-n",
    "-F",
    "-E",
    "73",
    join(lockRoot, `worker-${kind}.lock`),
    process.execPath,
    import.meta.filename,
    kind,
    "--locked",
  ];
  if (process.env.CAPE_DATABASE_MODE === "production") {
    if (typeof process.execve !== "function") throw Error("Node 24 execve support required");
    try {
      process.execve("/usr/bin/flock", ["/usr/bin/flock", ...lockArgs], process.env);
    } catch {
      throw Error("Production worker lock process replacement failed");
    }
    throw Error("Production worker lock process replacement returned unexpectedly");
  }
  const holder = spawn("flock", lockArgs, { stdio: "inherit", env: process.env });
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => holder.kill(signal));
  const code = await new Promise((resolve) => {
    holder.once("error", () => resolve(1));
    holder.once("exit", (code) => resolve(code ?? 1));
  });
  if (code === 73) console.error(`Another ${kind} worker loop is already running.`);
  process.exit(code);
}

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
process.exitCode = await supervise({
  stopping: () => stopping,
  cycle: () =>
    new Promise((resolve) => {
      child = spawn(process.execPath, [paths[kind]], { stdio: "inherit", env: process.env });
      child.once("error", () => resolve(1));
      child.once("exit", (code) => resolve(code ?? 1));
    }).finally(() => {
      child = undefined;
    }),
  report: (status) => {
    console.log(
      JSON.stringify({ event: "worker.cycle", kind, correlationId: randomUUID(), ...status }),
    );
    if (status.alert)
      console.error(`Worker ${kind} failed three consecutive cycles; supervision is unhealthy.`);
  },
  pause: () =>
    new Promise((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, 60000 + Math.floor(Math.random() * 5000));
    }),
});
