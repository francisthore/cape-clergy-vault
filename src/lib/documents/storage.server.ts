import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { resolve, parse, join } from "node:path";
import { createHash } from "node:crypto";

export class DocumentError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export type StoredObject = { byteSize: number; sha256: string };
export interface OpenObject {
  byteSize: number;
  read: () => Promise<Uint8Array | null>;
  close: () => Promise<void>;
}
export interface StorageProvider {
  save(key: string, body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<StoredObject>;
  open(key: string): Promise<OpenObject>;
  delete(key: string): Promise<void>;
}
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validateFileName(input: string): string {
  const name = input.normalize("NFC");
  if (
    name !== name.trim() ||
    Buffer.byteLength(name) > 180 ||
    // eslint-disable-next-line no-control-regex -- Reject filename control characters.
    /[\x00-\x1f\x7f/\\:<>"|?*\u202a-\u202e\u2066-\u2069]/.test(name) ||
    !/^[^.].*\.pdf$/i.test(name)
  )
    throw new DocumentError(400, "Select a PDF with a valid filename (maximum 180 UTF-8 bytes).");
  return name;
}
export class LocalPrivateStorageProvider implements StorageProvider {
  private root: string;
  private maxBytes: number;
  constructor(root: string, maxBytes = 20 * 1024 * 1024) {
    this.root = resolve(root);
    this.maxBytes = maxBytes;
    if (this.root.split("/").some((p) => ["public", "dist", ".output", "node_modules"].includes(p)))
      throw new Error("Private storage configuration rejected");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 20 * 1024 * 1024)
      throw new Error("Upload limit must be between 1 byte and 20 MiB");
  }
  private async directory() {
    // Check every ancestor; no untrusted intermediate symlink is followed.
    let current = parse(this.root).root;
    for (const segment of this.root.slice(current.length).split("/")) {
      current = join(current, segment);
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe storage directory");
    }
    const stat = await lstat(this.root);
    if (
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.() ||
      (await realpath(this.root)) !== this.root
    )
      throw new Error("Private storage ownership/permissions required");
  }
  private path(key: string, suffix: "blob" | "part") {
    if (!keyPattern.test(key)) throw new DocumentError(400, "Invalid object identifier.");
    return join(this.root, `${key}.${suffix}`);
  }
  async save(
    key: string,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<StoredObject> {
    const temporary = this.path(key, "part"),
      final = this.path(key, "blob");
    await this.directory();
    const reader = body.getReader();
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    ).catch(async (error: unknown) => {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      throw error;
    });
    let size = 0,
      prefix = Buffer.alloc(0),
      tail = Buffer.alloc(0);
    const hash = createHash("sha256");
    const abort = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > this.maxBytes)
          throw new DocumentError(413, "Document exceeds the upload limit.");
        const bytes = Buffer.from(
          chunk.value.buffer,
          chunk.value.byteOffset,
          chunk.value.byteLength,
        );
        if (prefix.length < 16)
          prefix = Buffer.concat([prefix, bytes.subarray(0, 16 - prefix.length)]);
        tail =
          bytes.length >= 1024
            ? Buffer.from(bytes.subarray(-1024))
            : Buffer.concat([tail, bytes]).subarray(-1024);
        hash.update(bytes);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await file.write(
            bytes,
            offset,
            Math.min(64 * 1024, bytes.length - offset),
          );
          if (!bytesWritten) throw new Error("Storage write failed");
          offset += bytesWritten;
        }
      }
      if (!size) throw new DocumentError(400, "Empty documents are not allowed.");
      // Conservative signature/trailer detection, not a PDF parser or malware scanner.
      if (
        !/^%PDF-(1\.[0-7]|2\.0)[\r\n]/.test(prefix.toString("latin1")) ||
        !/%%EOF\s*$/.test(tail.toString("latin1"))
      )
        throw new DocumentError(415, "The file must contain a PDF header and end marker.");
      await file.sync();
      await file.close();
      signal.throwIfAborted();
      // Hard-link publication is atomic and fails if the destination already exists.
      await link(temporary, final);
      await unlink(temporary);
      const dir = await open(
        this.root,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
      return { byteSize: size, sha256: hash.digest("hex") };
    } finally {
      signal.removeEventListener("abort", abort);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      await file.close().catch(() => undefined);
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw new Error("Temporary storage cleanup required");
      });
    }
  }
  async open(key: string): Promise<OpenObject> {
    const path = this.path(key, "blob");
    await this.directory();
    // NONBLOCK avoids blocking on an injected FIFO before the regular-file check.
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        (stat.mode & 0o077) !== 0 ||
        stat.uid !== process.getuid?.()
      )
        throw new Error("Unsafe storage object");
      let position = 0,
        closed = false;
      const close = async () => {
        if (!closed) {
          closed = true;
          await file.close();
        }
      };
      return {
        byteSize: stat.size,
        close,
        async read() {
          if (closed) throw new Error("Object closed");
          const buffer = Buffer.allocUnsafe(64 * 1024);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
          position += bytesRead;
          return bytesRead ? buffer.subarray(0, bytesRead) : null;
        },
      };
    } catch (error) {
      await file.close();
      throw error;
    }
  }
  async delete(key: string) {
    const path = this.path(key, "blob");
    await this.directory();
    // Unlink never follows the leaf; only known failed-row keys reach this method.
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export function configuredStorage() {
  if ((process.env["CAPE_STORAGE_PROVIDER"] ?? "local") !== "local")
    throw new Error("Unsupported storage provider");
  if ((process.env["CAPE_DOCUMENT_TYPES"] ?? "pdf") !== "pdf")
    throw new Error("Only PDF validation is implemented");
  return new LocalPrivateStorageProvider(
    process.env["CAPE_STORAGE_ROOT"] ?? ".local/storage",
    Number(process.env["CAPE_MAX_UPLOAD_BYTES"] ?? 20 * 1024 * 1024),
  );
}
