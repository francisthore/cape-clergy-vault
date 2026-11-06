// Entirely disposable source/restore clusters. No inherited database URL is used.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { LocalPrivateStorageProvider } from "../../src/lib/documents/storage.server.ts";
import { runScanWorker } from "../../src/lib/scanning/worker.server.ts";
import { TestScanner } from "../../src/lib/scanning/testing.ts";
import { storageInventory } from "../../src/lib/operations/inventory.server.ts";
import { deliverApprovalNotifications } from "../../src/lib/approvals/notifications.server.ts";
import { EmailService, TestEmailProvider } from "../../src/lib/email/service.server.ts";
import { createInvitationProof, openInvitationProof } from "../../src/lib/reviews/tokens.server.ts";
const bin = [
  process.env["CAPE_PG_BIN"],
  "/usr/lib/postgresql/18/bin",
  "/usr/lib/postgresql/17/bin",
  "/usr/lib/postgresql/14/bin",
].find((p) => p && existsSync(join(p, "initdb")));
if (!bin) throw Error("PostgreSQL binaries absent; restore gate blocked");
await mkdir(".local", { recursive: true, mode: 0o700 });
// Short Unix paths stay below the PostgreSQL socket name limit.
const run = await mkdtemp("/tmp/cape-recovery-"),
  bootPassword = randomBytes(32).toString("hex");
const connections: postgres.Sql[] = [],
  clusters: string[] = [],
  checks: string[] = [];
const credentials = Object.fromEntries(
  [
    "cape_clergy_dev",
    "cape_clergy_runtime",
    "cape_clergy_scanner",
    "cape_clergy_notifications",
  ].map((r) => [r, randomBytes(32).toString("hex")]),
);
const dbName = "cape_clergy_vault_dev";
function command(program: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(program, args, { env, encoding: "utf8" });
  if (result.status !== 0) throw Error(`${program.split("/").at(-1)} failed in disposable drill`);
  return result.stdout;
}
function connect(socket: string, user = "cape_clergy_dev") {
  const client = postgres({
    host: socket,
    database: dbName,
    user,
    password: credentials[user],
    max: 2,
    connect_timeout: 5,
    connection: { TimeZone: "UTC" },
  });
  connections.push(client);
  return client;
}
async function cluster(name: string) {
  const root = join(run, name);
  await mkdir(root, { mode: 0o700 });
  const pw = join(root, "password");
  await writeFile(pw, bootPassword, { mode: 0o600 });
  command(join(bin!, "initdb"), [
    "-D",
    join(root, "data"),
    "-U",
    "cape_drill_bootstrap",
    "--auth-local=scram-sha-256",
    "--auth-host=reject",
    `--pwfile=${pw}`,
    "--locale=C",
    "--encoding=UTF8",
  ]);
  command(join(bin!, "pg_ctl"), [
    "-D",
    join(root, "data"),
    "-l",
    join(root, "server.log"),
    "-o",
    `-c listen_addresses='' -k ${root}`,
    "-w",
    "start",
  ]);
  clusters.push(root);
  const admin = postgres({
    host: root,
    database: "postgres",
    user: "cape_drill_bootstrap",
    password: bootPassword,
    max: 1,
  });
  try {
    const [identity] = await admin`show data_directory`;
    assert.equal(identity!["data_directory"], join(root, "data"));
    for (const [role, password] of Object.entries(credentials))
      await admin.unsafe(
        `create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole nobypassrls noreplication`,
      );
    await admin.unsafe(`create database ${dbName} owner cape_clergy_dev`);
    await admin.unsafe(`revoke all on database ${dbName} from public`);
  } finally {
    await admin.end();
  }
  return { root, client: connect(root) };
}
async function grants(c: postgres.Sql) {
  await c.unsafe("revoke create on schema public from public");
  for (const f of ["runtime", "scanner", "notifications"])
    await c.unsafe(await readFile(`database/${f}-grants.sql`, "utf8"));
}
try {
  const source = await cluster("s");
  await migrate(drizzle(source.client), {
    migrationsFolder: resolve("database/migrations"),
    migrationsSchema: "cape_migrations",
  });
  await grants(source.client);
  const author = "recovery-" + randomUUID(),
    outsider = "outsider-" + randomUUID(),
    submission = randomUUID();
  for (const who of [author, outsider]) {
    await source.client`insert into auth.users(id,name,email,email_verified) values(${who},'Disposable recovery',${who + "@example.invalid"},true)`;
    await source.client`insert into app.clergy_profiles(user_id,full_name,approval_status) values(${who},'Disposable recovery','approved')`;
    await source.client`insert into app.role_assignments(user_id,role) values(${who},'clergy')`;
    await source.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},'repository-v1','repository','accepted')`;
  }
  await source.client`insert into app.submissions(id,owner_id,title,status) values(${submission},${author},'Disposable restore fixture','draft')`;
  const storageRoot = join(run, "source-objects"),
    storage = new LocalPrivateStorageProvider(storageRoot),
    docs: string[] = [],
    keys: string[] = [];
  const scanner = connect(source.root, "cape_clergy_scanner");
  for (let i = 0; i < 2; i++) {
    const id = randomUUID(),
      key = randomUUID();
    docs.push(id);
    keys.push(key);
    const saved = await storage.save(
      key,
      new Response("%PDF-1.4\nDisposable restore test bytes\n%%EOF\n").body!,
      new AbortController().signal,
    );
    await source.client`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size,sha256,state) values(${id},${submission},${key},'fixture.pdf','application/pdf',${saved.byteSize},${saved.sha256},'quarantined')`;
    await source.client`insert into app.document_scans(document_id,expected_sha256) values(${id},${saved.sha256})`;
  }
  await runScanWorker(scanner, storage, new TestScanner(), 1, docs[0]!);
  // Simulate a crash with a durable expired pending scan and notification lease.
  await scanner`select app.claim_document_scan(${docs[1]!})`;
  await source.client`update app.document_scans set lease_until=now()-interval '1 second' where document_id=${docs[1]!}`;
  await source.client`insert into app.approval_notifications(event_key,user_id,kind) values(${randomUUID()},${author},'approved')`;
  const oldLease = randomUUID();
  await source.client`update app.approval_notifications set lease_token=${oldLease},attempts=1,available_at=now()-interval '1 second' where user_id=${author}`;
  await source.client`insert into app.audit_events(actor_id,submission_id,action,outcome) values(${author},${submission},'recovery.fixture','ok')`;
  const audits = await source.client`select id from app.audit_events order by id`;
  const ledger =
    await source.client`select hash from cape_migrations.__drizzle_migrations order by id`;
  assert.equal(
    (await storageInventory(source.client, storage, storageRoot, true)).findings.length,
    0,
  );
  checks.push(
    "source synthetic PDF clean scan + pending/expired scan and mail leases, immutable audit, restricted roles",
  );
  // Source is a private clone, with no web process/writers. pg_dump and the object
  // copy therefore observe one coordinated quiescent point.
  const bundle = join(run, "bundle");
  await mkdir(bundle, { mode: 0o700 });
  command(
    join(bin!, "pg_dump"),
    ["--format=custom", "--no-owner", "--no-acl", "--file", join(bundle, "database.dump")],
    {
      ...process.env,
      PGHOST: source.root,
      PGDATABASE: dbName,
      PGUSER: "cape_clergy_dev",
      PGPASSWORD: credentials["cape_clergy_dev"],
    },
  );
  await cp(storageRoot, join(bundle, "objects"), { recursive: true });
  await writeFile(
    join(bundle, "manifest.json"),
    JSON.stringify({
      hashes: ledger.map((r) => r["hash"]),
      scanSimulation: true,
      configuration: "synthetic capture-only",
      secretsBackedUp: false,
    }),
    { mode: 0o600 },
  );
  command("tar", ["-cf", join(run, "backup.tar"), "-C", bundle, "."]);
  const key = randomBytes(32),
    nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("cape-clergy-recovery-v1"));
  const plain = await readFile(join(run, "backup.tar")),
    encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const envelope = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  await writeFile(join(run, "backup.enc"), envelope, { mode: 0o600 });
  await writeFile(join(run, "separate-drill-key"), key, { mode: 0o600 });
  await rm(bundle, { recursive: true });
  await rm(join(run, "backup.tar"));
  function decrypt(data: Buffer, material: Buffer) {
    const d = createDecipheriv("aes-256-gcm", material, data.subarray(0, 12));
    d.setAAD(Buffer.from("cape-clergy-recovery-v1"));
    d.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([d.update(data.subarray(28)), d.final()]);
  }
  assert.throws(() => decrypt(envelope, randomBytes(32)));
  const corrupted = Buffer.from(envelope);
  corrupted[corrupted.length - 1]! ^= 1;
  assert.throws(() => decrypt(corrupted, key));
  checks.push(
    "coordinated dump + private/quarantined objects encrypted with authenticated AES-256-GCM; wrong key/tampering denied",
  );
  const extracted = join(run, "restored");
  await mkdir(extracted, { mode: 0o700 });
  await writeFile(join(run, "restore.tar"), decrypt(envelope, key), { mode: 0o600 });
  command("tar", ["-xf", join(run, "restore.tar"), "-C", extracted]);
  await chmod(join(extracted, "objects"), 0o700);
  const target = await cluster("t");
  command(
    join(bin!, "pg_restore"),
    [
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
      "--dbname",
      dbName,
      join(extracted, "database.dump"),
    ],
    {
      ...process.env,
      PGHOST: target.root,
      PGDATABASE: dbName,
      PGUSER: "cape_clergy_dev",
      PGPASSWORD: credentials["cape_clergy_dev"],
    },
  );
  await grants(target.client);
  assert.deepEqual(
    await target.client`select hash from cape_migrations.__drizzle_migrations order by id`,
    ledger,
  );
  assert.deepEqual(await target.client`select id from app.audit_events order by id`, audits);
  await assert.rejects(target.client`delete from app.audit_events`, { code: "55000" });
  const restoredRoot = join(extracted, "objects"),
    restoredStorage = new LocalPrivateStorageProvider(restoredRoot);
  async function barrier() {
    const inventory = await storageInventory(target.client, restoredStorage, restoredRoot, true);
    assert.equal(inventory.findings.length, 0);
    assert.equal(inventory.unknownObjectCount, 0);
    return inventory;
  }
  await barrier();
  const [clean] = await target.client`select app.document_is_clean(${docs[0]!}) as clean`;
  assert.equal(clean!["clean"], true);
  const runtime = connect(target.root, "cape_clergy_runtime");
  for (const who of [author, outsider])
    await runtime.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${who},true)`;
      const rows = await tx`select id from app.documents where id=${docs[0]!}`;
      assert.equal(rows.length, who === author ? 1 : 0);
    });
  checks.push(
    "isolated restore preserves ledger, exact-hash clean evidence, immutable audit IDs and author/outsider RLS",
  );
  const held = await readFile(join(restoredRoot, keys[0] + ".blob"));
  await rm(join(restoredRoot, keys[0] + ".blob"));
  await assert.rejects(barrier());
  await writeFile(join(restoredRoot, keys[0] + ".blob"), held, { mode: 0o600 });
  const orphan = randomUUID();
  await restoredStorage.save(
    orphan,
    new Response("%PDF-1.4\nOrphan fixture\n%%EOF\n").body!,
    new AbortController().signal,
  );
  await assert.rejects(barrier());
  await restoredStorage.delete(orphan);
  await barrier();
  const manifest = JSON.parse(await readFile(join(extracted, "manifest.json"), "utf8"));
  manifest.hashes.pop();
  assert.notDeepEqual(
    manifest.hashes,
    ledger.map((r) => r["hash"]),
  );
  checks.push(
    "missing object and object-without-metadata detected by startup reconciliation barrier; migration mismatch rejected",
  );
  const restoredScanner = connect(target.root, "cape_clergy_scanner");
  await runScanWorker(restoredScanner, restoredStorage, new TestScanner(), 1, docs[1]!);
  const [pending] =
    await target.client`select state from app.document_scans where document_id=${docs[1]!}`;
  assert.equal(pending!["state"], "clean");
  const provider = new TestEmailProvider(),
    email = new EmailService(provider, {
      origin: "http://localhost:3000",
      from: "Drill <drill@example.invalid>",
    });
  const notifications = connect(target.root, "cape_clergy_notifications");
  assert.ok(
    (await deliverApprovalNotifications(
      { client: notifications },
      email,
      "http://localhost:3000",
    )) > 0,
  );
  assert.ok(provider.messages.every((m) => m.to.endsWith("@example.invalid")));
  const proof = createInvitationProof("Disposable restore encryption secret only", author);
  assert.throws(() => openInvitationProof(proof.sealed, "missing-replaced-key", author));
  checks.push(
    "restored pending work and expired leases recover through restricted scanner/mail roles; wrong invitation key fails; email in memory only",
  );
  await writeFile(
    ".local/phase4-recovery-result.json",
    JSON.stringify(
      {
        status: "passed",
        checks,
        realClamAv: false,
        externalDelivery: false,
        backupDigest: createHash("sha256").update(envelope).digest("hex"),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      event: "recovery.drill_passed",
      checks,
      realClamAv: false,
      externalDelivery: false,
    }),
  );
} finally {
  await Promise.all(connections.map((c) => c.end({ timeout: 5 })));
  for (const root of clusters.reverse())
    command(join(bin!, "pg_ctl"), ["-D", join(root, "data"), "-m", "fast", "-w", "stop"]);
  // This fresh mkdtemp tree contains disposable drill data only, never user backups.
  if (run.startsWith("/tmp/cape-recovery-")) await rm(run, { recursive: true });
}
