// Test in an explicit source snapshot with a separate fixed local endpoint. The
// real application's fixed-port guards and running project cluster stay intact.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const repository = fileURLToPath(new URL("../../", import.meta.url));
const root = await mkdtemp("/tmp/cape-p42-source-");
const results = join(repository, ".local/phase42-results");
await mkdir(results, { recursive: true, mode: 0o700 });
const environment = { PATH: process.env["PATH"], HOME: process.env["HOME"], NODE_ENV: "test" };
async function run(args: string[], log: string) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...environment, NODE_ENV: log === "build.log" ? "production" : "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
    process.stderr.write(chunk);
  });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    await writeFile(join(results, log), output, { mode: 0o600 });
    assert.equal(code, 0, `Phase 4.2 ${log} must pass`);
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}
try {
  // No .env, captures, private storage, .git or other projects are copied.
  const config = (await readdir(repository)).filter((name) =>
    /^(?:package(?:-lock)?\.json|(?:vite|vitest|tsconfig|playwright|drizzle|eslint|postcss|tailwind).*\.(?:ts|js|json|cjs|mjs))$/.test(
      name,
    ),
  );
  for (const name of [...config, "src", "public", "database", "scripts", "browser"])
    await cp(join(repository, name), join(root, name), { recursive: true });
  await symlink(join(repository, "node_modules"), join(root, "node_modules"), "dir");
  const safety = join(root, "database/safety.ts"),
    source = await readFile(safety, "utf8");
  assert.equal(source.split("port: 55432,").length, 2);
  await writeFile(safety, source.replace("port: 55432,", "port: 55433,"));
  // Only the isolated copy permits 55433, with all original role/marker/RLS checks.
  if (process.argv[2] === "--phase43") {
    // Phase 4.3 audit probes need only the fresh disposable cluster, not the browser stack.
    await run(["scripts/db/phase41b-test.ts", "--phase43"], "phase43-security.log");
  } else {
    await run(["node_modules/vite/bin/vite.js", "build"], "build.log");
    await run(["scripts/db/phase41b-test.ts"], "bouncer-database.log");
    await run(["scripts/db/phase41b-test.ts", "--phase42"], "integration-browser.log");
  }
} finally {
  // Interrupted Playwright runs can leave a web-server grandchild. Target only
  // processes inside this exact disposable source tree, before removing it.
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => "");
    if (cwd === root || cwd.startsWith(root + "/")) {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        /* Already stopped. */
      }
    }
  }
  await cp(
    join(root, ".local/phase42-browser-report.json"),
    join(results, "browser-report.json"),
  ).catch(() => undefined);
  await cp(join(root, ".local/phase42-browser-results"), join(results, "browser-results"), {
    recursive: true,
  }).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
