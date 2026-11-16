import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { configuration, checkPort, root } from "./dev-all.mjs";
import { supervise } from "./worker-supervisor.mjs";
const url = (role) =>
  `postgresql://cape_clergy_${role}:disposable@127.0.0.1:55432/cape_clergy_vault_dev`;
const auth =
  "BETTER_AUTH_URL=http://localhost:3000\nBETTER_AUTH_SECRET=Disposable-configuration-secret-minimum-32\nEMAIL_PROVIDER=development\n";
test("launcher configuration fails closed and isolates process credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cape-dev-config-"));
  try {
    await assert.rejects(configuration(directory, []), /Missing or unreadable/);
    const files = {
      ".env.db.local": `CAPE_DATABASE_URL=${url("dev")}`,
      ".env.db.runtime.local": `CAPE_RUNTIME_DATABASE_URL=${url("runtime")}`,
      ".env.db.scanner.local": `CAPE_SCANNER_DATABASE_URL=${url("scanner")}\nCAPE_SCANNER=bouncer\nBOUNCER_API_KEY=disposable-scanner-key`,
      ".env.db.notifications.local": `CAPE_NOTIFICATION_DATABASE_URL=${url("notifications")}`,
      ".env.auth.local": auth,
    };
    for (const [name, value] of Object.entries(files))
      await writeFile(join(directory, name), value);
    await assert.rejects(configuration(directory, []), /allow-capture-email/);
    await assert.rejects(configuration(directory, ["--allow-capture-email"]), /allow-bouncer/);
    const flags = ["--allow-capture-email", "--allow-bouncer"];
    const config = await configuration(directory, flags);
    for (const key of [
      "CAPE_DATABASE_URL",
      "CAPE_SCANNER_DATABASE_URL",
      "CAPE_NOTIFICATION_DATABASE_URL",
      "BOUNCER_API_KEY",
    ])
      assert.equal(config.web[key], undefined);
    assert.equal(config.scanner.BETTER_AUTH_SECRET, undefined);
    assert.equal(config.mail.CAPE_SCANNER_DATABASE_URL, undefined);
    assert.equal(config.mail.EMAIL_PROVIDER, "development");
    await writeFile(
      join(directory, ".env.auth.local"),
      auth.replace("development", "resend") +
        "RESEND_API_KEY=disposable\nEMAIL_DOMAIN_VERIFIED=true\n",
    );
    await assert.rejects(configuration(directory, flags), /allow-live-email/);
    const live = await configuration(directory, ["--allow-live-email", "--allow-bouncer"]);
    assert.equal(live.mail.EMAIL_PROVIDER, "resend");
    await writeFile(join(directory, ".env.local"), "VITE_BOUNCER_API_KEY=disposable");
    await assert.rejects(
      configuration(directory, ["--allow-live-email", "--allow-bouncer"]),
      /Privileged configuration/,
    );
    await rm(join(directory, ".env.local"));
    await writeFile(
      join(directory, ".env.db.runtime.local"),
      `CAPE_RUNTIME_DATABASE_URL=${url("dev")}`,
    );
    await assert.rejects(configuration(directory, flags), /Refusing database target/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("port conflicts are explicit without stopping the existing listener", async () => {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(3000, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
  }
  try {
    await assert.rejects(checkPort(), /Port 3000/);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});
test("an IPv6 localhost listener is also treated as a port conflict", async (t) => {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(3000, "::1", resolve);
    });
  } catch (error) {
    if (["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) {
      t.skip("IPv6 is unavailable on this host");
      return;
    }
    if (error.code !== "EADDRINUSE") throw error;
  }
  try {
    await assert.rejects(checkPort(), /Port 3000/);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});
test("supervisor surfaces repeated failures, resets counts after recovery, and stops gracefully", async () => {
  let index = 0;
  const codes = [1, 1, 0, 1, 1, 1];
  const reports = [];
  assert.equal(
    await supervise({
      cycle: async () => codes[index++],
      pause: async () => {},
      stopping: () => false,
      report: (status) => reports.push(status),
    }),
    1,
  );
  assert.deepEqual(
    reports.map((r) => r.consecutiveFailures),
    [1, 2, 0, 1, 2, 3],
  );
  assert.equal(reports.at(-1).alert, true);
  let stopping = false;
  assert.equal(
    await supervise({
      cycle: async () => {
        stopping = true;
        return 0;
      },
      pause: async () => assert.fail("No pause after shutdown"),
      stopping: () => stopping,
      report: () => {},
    }),
    0,
  );
});
test("a duplicate worker loop is refused without starting a batch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cape-worker-lock-"));
  await mkdir(join(directory, ".local"), { recursive: true });
  const holder = spawn(
    "flock",
    [
      "-n",
      "-F",
      join(directory, ".local/worker-scanner.lock"),
      "node",
      "-e",
      'console.log("locked");setInterval(()=>{},1000)',
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await new Promise((resolve, reject) => {
      holder.stdout.once("data", resolve);
      holder.once("exit", () => reject(Error("Cannot acquire isolated worker lock for test")));
    });
    const child = spawn(process.execPath, [join(root, "scripts/worker-loop.mjs"), "scanner"], {
      cwd: directory,
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    assert.equal(await new Promise((resolve) => child.once("exit", resolve)), 73);
    assert.match(output, /already running/);
  } finally {
    holder.kill("SIGTERM");
    await new Promise((resolve) => holder.once("close", resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("launcher starts one isolated group, refuses duplicates, and reaps children on shutdown or failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cape-launcher-lifecycle-"));
  const write = (name, text) => writeFile(join(directory, name), text);
  const run = () => {
    const child = spawn(
      "bash",
      ["scripts/dev-all.sh", "--allow-capture-email", "--allow-bouncer"],
      {
        cwd: directory,
        env: { PATH: process.env.PATH, HOME: directory },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    const exited = new Promise((resolve) => child.once("close", resolve));
    return { child, exited, output: () => output };
  };
  let group;
  try {
    for (const name of [
      "scripts",
      "scripts/db",
      "database",
      "node_modules/vite/bin",
      "src/lib/scanning",
      "src/lib/documents",
    ])
      await mkdir(join(directory, name), { recursive: true });
    for (const name of [
      "scripts/dev-all.sh",
      "scripts/dev-all.mjs",
      "database/safety.ts",
      "src/lib/scanning/bouncer.server.ts",
      "src/lib/documents/validation.ts",
    ])
      await write(
        name,
        await (await import("node:fs/promises")).readFile(join(root, name), "utf8"),
      );
    for (const [name, value] of Object.entries({
      ".env.db.local": `CAPE_DATABASE_URL=${url("dev")}`,
      ".env.db.runtime.local": `CAPE_RUNTIME_DATABASE_URL=${url("runtime")}`,
      ".env.db.scanner.local": `CAPE_SCANNER_DATABASE_URL=${url("scanner")}\nCAPE_SCANNER=bouncer\nBOUNCER_API_KEY=disposable`,
      ".env.db.notifications.local": `CAPE_NOTIFICATION_DATABASE_URL=${url("notifications")}`,
      ".env.auth.local": auth,
    }))
      await write(name, value);
    // Every command below is a disposable stub. No database/provider operation.
    await mkdir(join(directory, "scripts/db"), { recursive: true });
    await write("scripts/db/local-postgres.ts", 'console.log("fixture database unchanged")');
    await write("scripts/dev-preflight.ts", 'console.log("fixture preflight")');
    const stub = `import {writeFileSync} from 'node:fs';
const kind=process.argv[2]??'web';
if(process.env.CAPE_DATABASE_URL)throw Error('Owner credential leak');
if(kind==='web'&&(process.env.BOUNCER_API_KEY||process.env.CAPE_NOTIFICATION_DATABASE_URL))throw Error('Worker credential leak');
writeFileSync('.local/'+kind+'.pid',String(process.pid));
const timer=setInterval(()=>{},1000);
process.on('SIGTERM',()=>{clearInterval(timer);console.log('fixture stopped '+kind)});
console.log('fixture ready '+kind);`;
    await write("scripts/worker-loop.mjs", stub);
    await write("node_modules/vite/bin/vite.js", stub.replace("process.argv[2]??'web'", "'web'"));
    group = run();
    const waitReady = async (current) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (
          ["web", "scanner", "approval", "reviewer"].every((kind) =>
            current.output().includes("fixture ready " + kind),
          )
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail(current.output());
    };
    await waitReady(group);
    const duplicate = run();
    assert.equal(await duplicate.exited, 1);
    assert.match(duplicate.output(), /holds the project lock/);
    group.child.kill("SIGTERM");
    assert.equal(await group.exited, 143);
    for (const kind of ["web", "scanner", "approval", "reviewer"])
      assert.match(group.output(), new RegExp("fixture stopped " + kind));
    group = run();
    await waitReady(group);
    const pid = Number(
      await (
        await import("node:fs/promises")
      ).readFile(join(directory, ".local/scanner.pid"), "utf8"),
    );
    process.kill(pid, "SIGTERM");
    assert.equal(await group.exited, 1);
    assert.match(group.output(), /scanner exited; stopping/);
    assert.match(group.output(), /PostgreSQL and all stored data retained/);
  } finally {
    if (group && group.child.exitCode === null) {
      group.child.kill("SIGTERM");
      await group.exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
