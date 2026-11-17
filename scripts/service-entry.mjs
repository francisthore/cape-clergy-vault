// Production systemd entry. No dotenv loading, owner credentials or request-triggered work.
import { readFile, lstat } from "node:fs/promises";
const kind = process.argv[2],
  kinds = ["web", "scanner", "approval", "reviewer"];
if (
  !kinds.includes(kind) ||
  process.env.CAPE_DATABASE_MODE !== "production" ||
  process.getuid?.() === 0 ||
  process.pid !== 1
)
  throw Error("Dedicated unprivileged production PID namespace required");
const directory = `/run/credentials/cape-vault-${kind}.service`;
if (process.env.CREDENTIALS_DIRECTORY !== directory)
  throw Error("Dedicated credentials mount required");
for (const key of [
  "CAPE_DATABASE_URL",
  "CAPE_RUNTIME_DATABASE_URL",
  "CAPE_SCANNER_DATABASE_URL",
  "CAPE_NOTIFICATION_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BOUNCER_API_KEY",
  "RESEND_API_KEY",
])
  if (process.env[key]) throw Error("Production secrets must use scoped credentials");
const env = { ...process.env, CAPE_DATABASE_PASSWORD_FILE: directory + "/database-password" };
async function credential(name) {
  const path = directory + "/" + name,
    stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536 || (stat.mode & 0o077) !== 0)
    throw Error("Unsafe production credential");
  const value = (await readFile(path, "utf8")).replace(/\n$/, "");
  if (!value || /[\r\n\0]/.test(value)) throw Error("Invalid production credential");
  return value;
}
if (["web", "reviewer"].includes(kind)) env.BETTER_AUTH_SECRET = await credential("auth-secret");
if (kind === "scanner") env.BOUNCER_API_KEY = await credential("bouncer-key");
else if (env.EMAIL_PROVIDER === "resend") env.RESEND_API_KEY = await credential("resend-key");
const args = kind === "web" ? [".output/server/index.mjs"] : ["scripts/worker-loop.mjs", kind];
// Node 24 replaces this setup process, preserving PID 1 and avoiding a resident
// wrapper per service. No fallback may weaken the process/secret boundary.
if (typeof process.execve !== "function") throw Error("Node 24 execve support required");
try {
  process.execve(process.execPath, [process.execPath, ...args], env);
} catch {
  console.error("service.exec_failed");
  process.exit(1);
}
