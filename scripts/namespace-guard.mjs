// Fail-closed startup proof that the launcher really produced the intended sandbox.
// Pure parser so it can be unit-tested without root, namespaces or a host.
const ZERO = /^0+$/;
export function assertSandboxStatus(status) {
  const field = (name) => new RegExp(`^${name}:\\s*(.*)$`, "m").exec(status)?.[1]?.trim();
  for (const name of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) {
    const value = field(name);
    if (value === undefined || !ZERO.test(value))
      throw Error("Service must start with no capabilities");
  }
  if (field("NoNewPrivs") !== "1") throw Error("Service must start with no_new_privs");
}
// Fresh /proc of a private PID namespace lists only this process at startup (no children yet).
// NSpid is deliberately not used: a proc mounted inside the namespace reports only local ids.
export function assertProcView(entries) {
  const pids = entries.filter((name) => /^\d+$/.test(name));
  if (pids.length !== 1 || pids[0] !== "1") throw Error("Private PID namespace /proc required");
}
