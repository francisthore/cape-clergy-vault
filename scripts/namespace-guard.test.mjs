import assert from "node:assert/strict";
import { test } from "node:test";
import { assertProcView, assertSandboxStatus } from "./namespace-guard.mjs";
const base = {
  CapInh: "0000000000000000",
  CapPrm: "0000000000000000",
  CapEff: "0000000000000000",
  CapBnd: "0000000000000000",
  CapAmb: "0000000000000000",
  NoNewPrivs: "1",
};
const render = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}:\t${v}`)
    .join("\n");
test("accepts a capability-free no_new_privs process", () => {
  assertSandboxStatus(render(base));
});
for (const [name, patch] of Object.entries({
  "effective capability": { CapEff: "0000000000200000" },
  "bounding set left populated": { CapBnd: "000001ffffffffff" },
  "ambient capability": { CapAmb: "0000000000000001" },
  "missing no_new_privs": { NoNewPrivs: "0" },
  "missing capability line": { CapBnd: undefined },
}))
  test(`rejects ${name}`, () => {
    assert.throws(() => assertSandboxStatus(render({ ...base, ...patch })));
  });
test("accepts a /proc listing containing only PID 1", () => {
  assertProcView(["1", "self", "sys", "uptime"]);
});
test("rejects a /proc listing that reveals other processes", () => {
  assert.throws(() => assertProcView(["1", "412", "self"]));
  assert.throws(() => assertProcView(["412", "self"]));
  assert.throws(() => assertProcView([]));
});
