import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname } from "node:path";
import { readProductionCredential } from "./production-credential.mjs";

const secret = "test-only-credential-value-with-enough-length";
const pathFor = (service, name) => `/run/credentials/cape-vault-${service}.service/${name}`;

function fixture(path, changes = {}) {
  const file = {
    mode: 0o100440,
    uid: 0,
    gid: 0,
    nlink: 1,
    size: secret.length,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...changes,
  };
  let reads = 0;
  const fs = {
    realpath: async () => path,
    lstat: async (entry) =>
      entry === path
        ? file
        : {
            mode: 0o40755,
            uid: 0,
            isDirectory: () => true,
            isSymbolicLink: () => false,
          },
    readFile: async () => {
      reads++;
      return secret + "\n";
    },
  };
  return {
    fs,
    get reads() {
      return reads;
    },
  };
}

for (const [service, name] of [
  ["web", "auth-secret"],
  ["web", "database-password"],
  ["scanner", "bouncer-key"],
  ["scanner", "database-password"],
  ["approval", "resend-key"],
  ["approval", "database-password"],
  ["reviewer", "auth-secret"],
  ["reviewer", "resend-key"],
  ["reviewer", "database-password"],
  ["operator", "database-password"],
]) {
  test(`accepts scoped root:root 0440 ${service}/${name}`, async () => {
    const path = pathFor(service, name);
    assert.equal(await readProductionCredential(path, service, name, fixture(path).fs), secret);
  });
  test(`accepts protected 0600 ${service}/${name}`, async () => {
    const path = pathFor(service, name);
    assert.equal(
      await readProductionCredential(
        path,
        service,
        name,
        fixture(path, { mode: 0o100600, uid: process.getuid() }).fs,
      ),
      secret,
    );
  });
}

for (const [label, changes] of [
  ["world readable", { mode: 0o100444 }],
  ["world writable", { mode: 0o100442 }],
  ["group writable", { mode: 0o100460 }],
  ["group readable source", { mode: 0o100640 }],
  ["wrong owner", { uid: 12345 }],
  ["wrong group for 0440", { gid: 12345 }],
  ["hard link", { nlink: 2 }],
  ["oversize", { size: 65537 }],
  ["symlink", { isFile: () => false, isSymbolicLink: () => true }],
  ["directory", { isFile: () => false, isDirectory: () => true }],
])
  test(`rejects ${label} credentials before reading`, async () => {
    const path = pathFor("web", "auth-secret"),
      mock = fixture(path, changes);
    await assert.rejects(readProductionCredential(path, "web", "auth-secret", mock.fs));
    assert.equal(mock.reads, 0);
  });

test("rejects a symlinked path and unsafe credential directory", async () => {
  const path = pathFor("web", "auth-secret");
  const alias = fixture(path);
  alias.fs.realpath = async () => "/elsewhere";
  await assert.rejects(readProductionCredential(path, "web", "auth-secret", alias.fs));
  assert.equal(alias.reads, 0);
  const parent = fixture(path);
  parent.fs.lstat = async (entry) =>
    entry === dirname(path)
      ? { mode: 0o40775, uid: 0, isDirectory: () => true, isSymbolicLink: () => false }
      : fixture(path).fs.lstat(entry);
  await assert.rejects(readProductionCredential(path, "web", "auth-secret", parent.fs));
  assert.equal(parent.reads, 0);
});

test("rejects unexpected paths and another service's credential before reading", async () => {
  for (const [path, service, name] of [
    ["/etc/cape-vault/secrets/web/auth-secret", "web", "auth-secret"],
    [pathFor("scanner", "auth-secret"), "web", "auth-secret"],
    [pathFor("reviewer", "database-password"), "web", "database-password"],
    [pathFor("web", "bouncer-key"), "web", "bouncer-key"],
    [pathFor("operator", "auth-secret"), "operator", "auth-secret"],
  ]) {
    const mock = fixture(path);
    await assert.rejects(readProductionCredential(path, service, name, mock.fs));
    assert.equal(mock.reads, 0);
  }
});
