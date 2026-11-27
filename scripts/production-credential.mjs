// Shared boundary for the exact per-unit systemd credential mounts.
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname } from "node:path";

const names = {
  web: ["database-password", "auth-secret", "resend-key"],
  scanner: ["database-password", "bouncer-key"],
  approval: ["database-password", "resend-key"],
  reviewer: ["database-password", "auth-secret", "resend-key"],
  operator: ["database-password"],
};

export async function readProductionCredential(
  path,
  service,
  name,
  fs = { lstat, readFile, realpath },
) {
  const expected = `/run/credentials/cape-vault-${service}.service/${name}`;
  if (!Object.hasOwn(names, service) || !names[service].includes(name) || path !== expected)
    throw Error("Dedicated service credential required");
  if ((await fs.realpath(path)) !== path) throw Error("Unsafe production credential");
  const file = await fs.lstat(path);
  const uid = process.getuid?.();
  const privateMode = (file.mode & 0o077) === 0;
  // systemd 255 can expose a root:root 0440 copy to the scoped service.
  const systemdMode = (file.mode & 0o777) === 0o440 && file.uid === 0 && file.gid === 0;
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.nlink !== 1 ||
    file.size > 65536 ||
    (file.mode & 0o022) !== 0 ||
    ![0, uid].includes(file.uid) ||
    !(privateMode || systemdMode)
  )
    throw Error("Unsafe production credential");
  for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) {
    const info = await fs.lstat(parent);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      ![0, uid].includes(info.uid) ||
      (info.mode & 0o022) !== 0
    )
      throw Error("Unsafe production credential directory");
  }
  const value = (await fs.readFile(path, "utf8")).replace(/\n$/, "");
  if (!value || /[\r\n\0]/.test(value)) throw Error("Invalid production credential");
  return value;
}
