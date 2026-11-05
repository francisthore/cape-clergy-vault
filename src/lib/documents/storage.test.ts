// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  stat,
  chmod,
  writeFile,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { LocalPrivateStorageProvider, validateFileName } from "./storage.server";
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const roots: string[] = [];
async function fixture(limit = 20 * 1024 * 1024) {
  const root = await mkdtemp(join(tmpdir(), "cape-storage-test-"));
  roots.push(root);
  return { root, storage: new LocalPrivateStorageProvider(root, limit) };
}
const stream = (bytes = pdf) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("private local storage", () => {
  it("saves validated bytes, restrictive permissions, hash and bounded reads", async () => {
    const { root, storage } = await fixture();
    const id = randomUUID();
    const result = await storage.save(id, stream(), new AbortController().signal);
    expect(result).toEqual({
      byteSize: pdf.length,
      sha256: createHash("sha256").update(pdf).digest("hex"),
    });
    expect((await stat(join(root, id + ".blob"))).mode & 0o777).toBe(0o600);
    expect(await readdir(root)).toEqual([id + ".blob"]);
    const object = await storage.open(id);
    expect(await object.read()).toEqual(pdf);
    expect(await object.read()).toBeNull();
    await object.close();
    await object.close();
  });
  it("rejects traversal, user filenames as keys and public roots", async () => {
    const { storage } = await fixture();
    for (const key of ["../secret", "/etc/passwd", "a/b", "file.pdf", randomUUID() + "/../x"])
      await expect(storage.open(key)).rejects.toThrow();
    expect(() => new LocalPrivateStorageProvider("public/documents")).toThrow();
    expect(() => new LocalPrivateStorageProvider(".output/public/files")).toThrow();
    for (const name of [
      "../a.pdf",
      "a\\b.pdf",
      "a.pdf\r\nX: header",
      "a.exe",
      "",
      ".pdf",
      "a".repeat(180) + ".pdf",
      "x\u202ey.pdf",
    ])
      expect(() => validateFileName(name)).toThrow();
    expect(validateFileName("Théologie.pdf")).toBe("Théologie.pdf");
  });
  it("denies symlink roots, ancestors, objects, temporary objects and hard-linked objects", async () => {
    const { root, storage } = await fixture();
    const other = await fixture();
    const id = randomUUID();
    await symlink(other.root, join(root, "alias"));
    await expect(new LocalPrivateStorageProvider(join(root, "alias")).open(id)).rejects.toThrow();
    await expect(
      new LocalPrivateStorageProvider(join(root, "alias", "child")).open(id),
    ).rejects.toThrow();
    await writeFile(join(other.root, "secret"), pdf, { mode: 0o600 });
    await symlink(join(other.root, "secret"), join(root, id + ".blob"));
    await expect(storage.open(id)).rejects.toThrow();
    await symlink(join(other.root, "secret"), join(root, id + ".part"));
    await expect(storage.save(id, stream(), new AbortController().signal)).rejects.toThrow();
    expect(await readFile(join(other.root, "secret"))).toEqual(pdf);
    const hard = randomUUID();
    await link(join(other.root, "secret"), join(root, hard + ".blob"));
    await expect(storage.open(hard)).rejects.toThrow();
  });
  it("rejects weak root permissions, unknown type, empty and oversized bodies without partial objects", async () => {
    const { root, storage } = await fixture(100);
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.from("MZ executable"),
      Buffer.from("%PDF-1.7\nno trailer"),
      Buffer.alloc(101),
    ])
      await expect(
        storage.save(randomUUID(), stream(bytes), new AbortController().signal),
      ).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
    await chmod(root, 0o755);
    await expect(storage.open(randomUUID())).rejects.toThrow();
  });
  it("cleans source stream failures and cancellation", async () => {
    const { root, storage } = await fixture();
    let read = 0;
    const broken = new ReadableStream<Uint8Array>({
      pull(c) {
        if (read++) c.error(new Error("simulated source failure"));
        else c.enqueue(pdf.subarray(0, 12));
      },
    });
    await expect(
      storage.save(randomUUID(), broken, new AbortController().signal),
    ).rejects.toThrow();
    const abort = new AbortController();
    let cancelled = false;
    const hanging = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(pdf);
      },
      cancel() {
        cancelled = true;
      },
    });
    const task = storage.save(randomUUID(), hanging, abort.signal);
    setTimeout(() => abort.abort(), 10);
    await expect(task).rejects.toThrow();
    expect(cancelled).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });
  it("concurrent UUIDs are independent and duplicate publication cannot overwrite", async () => {
    const { root, storage } = await fixture();
    const ids = [randomUUID(), randomUUID()];
    await Promise.all(ids.map((id) => storage.save(id, stream(), new AbortController().signal)));
    await expect(storage.save(ids[0]!, stream(), new AbortController().signal)).rejects.toThrow();
    expect(await readFile(join(root, ids[0]! + ".blob"))).toEqual(pdf);
    expect((await readdir(root)).sort()).toEqual(ids.map((id) => id + ".blob").sort());
  });
});
