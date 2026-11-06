import { spawn } from "node:child_process";
import { mkdir, writeFile, unlink } from "node:fs/promises";
await unlink(new URL("../.local/browser-login-times.json", import.meta.url)).catch(() => undefined);
const root = new URL("../", import.meta.url).pathname;
await mkdir(root + ".local/browser-storage", { recursive: true, mode: 0o700 });
const guard = root + ".local/browser-network-guard.mjs";
await writeFile(
  guard,
  "const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('External network disabled in browser acceptance');return original(input,init)}",
  { mode: 0o600 },
);
// Construct the server environment explicitly. Operator/scanner credentials never enter web runtime.
const child = spawn(process.execPath, ["--import", guard, ".output/server/index.mjs"], {
  cwd: root,
  stdio: ["ignore", "ignore", "ignore"],
  env: {
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "3220",
    CAPE_RUNTIME_DATABASE_URL: process.env["CAPE_RUNTIME_DATABASE_URL"],
    BETTER_AUTH_URL: "http://localhost:3220",
    BETTER_AUTH_SECRET: "Disposable-browser-fixture-secret-Phase3F-ONLY",
    CAPE_STORAGE_ROOT: root + ".local/browser-storage",
    EMAIL_PROVIDER: "development",
    CAPE_LOCAL_EMAIL_CAPTURE: "true",
    RESEND_API_KEY: "",
    SUPABASE_URL: "",
    SUPABASE_PUBLISHABLE_KEY: "",
  },
});
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill(signal));
child.once("exit", (code) => process.exit(code ?? 0));
