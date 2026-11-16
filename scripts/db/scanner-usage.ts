// Worker-only manual monitoring. Never uploads bytes or consumes a scan.
import { configuredScanner } from "../../src/lib/scanning/scanner.server.ts";
import { BouncerScanner } from "../../src/lib/scanning/bouncer.server.ts";
try {
  const scanner = configuredScanner();
  if (!(scanner instanceof BouncerScanner)) throw Error("Bouncer not configured");
  const usage = await scanner.usage(AbortSignal.timeout(10000));
  console.log(
    JSON.stringify({
      event: "scan.bouncer.usage",
      ...usage,
      remaining: Math.max(0, usage.limit - usage.used),
    }),
  );
} catch {
  console.log(JSON.stringify({ event: "scan.bouncer.usage_unavailable" }));
  process.exitCode = 1;
}
