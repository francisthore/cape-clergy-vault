import { readFile, access } from "node:fs/promises";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { BouncerScanner } from "../src/lib/scanning/bouncer.server.ts";
import { validateLocalUrl } from "../database/safety.ts";

export const root = fileURLToPath(new URL("../", import.meta.url));
const pick = (values, names) =>
  Object.fromEntries(names.filter((k) => values[k] !== undefined).map((k) => [k, values[k]]));
export async function configuration(directory, flags) {
  for (const flag of flags)
    if (
      !["--allow-live-email", "--allow-capture-email", "--allow-bouncer", "--check"].includes(flag)
    )
      throw Error("Unknown launcher option. See docs/local-development.md.");
  const read = async (name) => {
    try {
      return parseEnv(await readFile(`${directory}/${name}`, "utf8"));
    } catch {
      throw Error(`Missing or unreadable configuration: ${name}`);
    }
  };
  const owner = await read(".env.db.local");
  const runtime = await read(".env.db.runtime.local");
  const scanner = await read(".env.db.scanner.local");
  const notifications = await read(".env.db.notifications.local");
  const auth = await read(".env.auth.local");
  for (const [env, key, role] of [
    [owner, "CAPE_DATABASE_URL", false],
    [runtime, "CAPE_RUNTIME_DATABASE_URL", true],
    [scanner, "CAPE_SCANNER_DATABASE_URL", "scanner"],
    [notifications, "CAPE_NOTIFICATION_DATABASE_URL", "notifications"],
  ]) {
    if (!env[key]) throw Error(`Missing required configuration: ${key}`);
    validateLocalUrl(env[key], role);
  }
  if (!["http://localhost:3000", "http://127.0.0.1:3000"].includes(auth.BETTER_AUTH_URL))
    throw Error("BETTER_AUTH_URL must match the local web server on port 3000.");
  if (!auth.BETTER_AUTH_SECRET || auth.BETTER_AUTH_SECRET.length < 32)
    throw Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  if (!["resend", "development"].includes(auth.EMAIL_PROVIDER))
    throw Error("Set EMAIL_PROVIDER explicitly to resend or development in .env.auth.local.");
  if (
    !flags.includes(
      auth.EMAIL_PROVIDER === "resend" ? "--allow-live-email" : "--allow-capture-email",
    )
  )
    throw Error(
      auth.EMAIL_PROVIDER === "resend"
        ? "Resend requires --allow-live-email; queued real emails may be sent immediately."
        : "Capture requires --allow-capture-email; queued mail is marked complete in the persistent database.",
    );
  if (
    auth.EMAIL_PROVIDER === "resend" &&
    (!auth.RESEND_API_KEY || auth.EMAIL_DOMAIN_VERIFIED !== "true")
  )
    throw Error("Resend requires RESEND_API_KEY and EMAIL_DOMAIN_VERIFIED=true.");
  const provider = scanner.CAPE_SCANNER ?? "clamav";
  if (!["bouncer", "clamav"].includes(provider))
    throw Error("CAPE_SCANNER must be bouncer or clamav.");
  if (provider === "bouncer" && !flags.includes("--allow-bouncer"))
    throw Error(
      "Bouncer requires --allow-bouncer; queued PDFs may be transferred externally immediately.",
    );
  if (provider === "bouncer" && !scanner.BOUNCER_API_KEY)
    throw Error("BOUNCER_API_KEY is required in the scanner environment.");
  if (provider === "bouncer")
    new BouncerScanner({
      apiKey: scanner.BOUNCER_API_KEY,
      uploadHost: scanner.BOUNCER_UPLOAD_HOST ?? "",
    });
  if (provider === "clamav") {
    try {
      await access(scanner.CAPE_CLAMD_SOCKET ?? "/run/clamav/clamd.sock");
    } catch {
      throw Error("ClamAV socket unavailable. Start your scanner or configure its socket.");
    }
  }
  if (
    (runtime.CAPE_STORAGE_ROOT ?? ".local/storage") !==
    (scanner.CAPE_STORAGE_ROOT ?? ".local/storage")
  )
    throw Error(
      "Web and scanner CAPE_STORAGE_ROOT must identify the same private storage directory.",
    );
  // Vite reads these itself. Reject privileged env and all secret-like public keys.
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    let values;
    try {
      values = parseEnv(await readFile(`${directory}/${name}`, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw Error(`Cannot inspect ${name}`);
    }
    if (
      Object.keys(values).some(
        (k) =>
          /^(CAPE_(DATABASE_URL|SCANNER|NOTIFICATION)|BOUNCER_)/.test(k) ||
          /^VITE_.*(SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL|BOUNCER|RESEND)/i.test(k),
      )
    )
      throw Error(`Privileged configuration must not appear in Vite environment file ${name}.`);
  }
  const base = pick(process.env, ["PATH", "HOME", "TMPDIR", "CAPE_PG_BIN"]);
  const mail = pick(auth, [
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "EMAIL_PROVIDER",
    "RESEND_API_KEY",
    "EMAIL_DOMAIN_VERIFIED",
    "EMAIL_FROM",
    "EMAIL_REPLY_TO",
  ]);
  const storage = [
    "CAPE_STORAGE_ROOT",
    "CAPE_STORAGE_PROVIDER",
    "CAPE_DOCUMENT_TYPES",
    "CAPE_MAX_UPLOAD_BYTES",
  ];
  return {
    owner: { ...base, ...pick(owner, ["CAPE_DATABASE_URL"]) },
    web: {
      ...base,
      ...pick(runtime, ["CAPE_RUNTIME_DATABASE_URL", ...storage]),
      ...mail,
      NODE_ENV: "development",
    },
    scanner: {
      ...base,
      ...pick(scanner, [
        "CAPE_SCANNER_DATABASE_URL",
        "CAPE_SCANNER",
        "BOUNCER_API_KEY",
        "BOUNCER_UPLOAD_HOST",
        "CAPE_CLAMD_SOCKET",
        "CAPE_SCAN_MAX_DEFINITION_AGE_HOURS",
        ...storage,
      ]),
    },
    mail: { ...base, ...pick(notifications, ["CAPE_NOTIFICATION_DATABASE_URL"]), ...mail },
    provider,
  };
}
export async function checkPort() {
  for (const host of ["127.0.0.1", "::1"]) {
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", (error) => {
        if (host === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) resolve();
        else reject(Error("Port 3000 is occupied or unavailable; stop the conflicting server."));
      });
      server.listen({ host, port: 3000, exclusive: true }, () => server.close(resolve));
    });
  }
}
async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 24 || (major === 24 && minor < 12)) throw Error("Node 24.12+ is required.");
  const flags = process.argv.slice(2);
  const env = await configuration(root, flags);
  await checkPort();
  if (flags.includes("--check")) {
    console.log("Configuration and port preflight passed. No database or workers started.");
    return;
  }
  const children = new Set();
  let stopping = false;
  const start = (label, args, environment) => {
    console.log(`Starting ${label}…`);
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: environment,
      stdio: "inherit",
      detached: true,
    });
    children.add(child);
    child.once("exit", () => {
      children.delete(child);
    });
    return child;
  };
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    console.log("Stopping web and workers; allowing active batches to finish (up to 195 seconds).");
    process.exitCode = code;
    const running = [...children];
    const done = Promise.all(
      running.map((child) => new Promise((resolve) => child.once("exit", resolve))),
    );
    for (const child of running) child.kill("SIGTERM");
    const deadline = setTimeout(() => {
      for (const child of running) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* exited */
        }
      }
    }, 195000);
    await done;
    clearTimeout(deadline);
    console.log("Development processes stopped. PostgreSQL and all stored data retained.");
  };
  process.on("SIGINT", () => void stop(130));
  process.on("SIGTERM", () => void stop(143));
  const run = (label, args, environment) =>
    new Promise((resolve, reject) => {
      const child = start(label, args, environment);
      child.once("error", () => reject(Error(`${label} could not start.`)));
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(Error(`${label} failed; no migration or repair was attempted.`)),
      );
    });
  try {
    await run("marked local PostgreSQL", ["scripts/db/local-postgres.ts", "start"], env.owner);
    if (stopping) return;
    // Read-only role/marker/privilege preflight, never owner DDL or provider I/O.
    await run("restricted database checks", ["scripts/dev-preflight.ts"], {
      ...env.web,
      ...env.scanner,
      ...env.mail,
    });
    if (stopping) return;
    for (const [label, args, environment] of [
      [
        "web — http://localhost:3000",
        ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "3000", "--strictPort"],
        env.web,
      ],
      ["scanner", ["scripts/worker-loop.mjs", "scanner"], env.scanner],
      [
        "approval and registration notifications",
        ["scripts/worker-loop.mjs", "approval"],
        env.mail,
      ],
      ["reviewer notifications", ["scripts/worker-loop.mjs", "reviewer"], env.mail],
    ]) {
      const child = start(label, args, environment);
      child.once("error", () => {
        console.error(`${label} could not start.`);
        void stop(1);
      });
      child.once("exit", () => {
        if (!stopping) {
          console.error(`${label} exited; stopping the development group.`);
          void stop(1);
        }
      });
    }
    console.log(
      "Workers run bounded cycles about once a minute. Three consecutive failed cycles stop the group. Ctrl+C to stop.",
    );
  } catch (e) {
    await stop(1);
    throw e;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
