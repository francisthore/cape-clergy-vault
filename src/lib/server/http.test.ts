// @vitest-environment node
import { it, expect } from "vitest";
import { readInput } from "./http.server";
const origin = "https://vault.example.invalid";
it("bounds authentication JSON while reading an unbounded stream without Content-Length", async () => {
  let reads = 0,
    cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(reads === 1 ? 16384 : 1));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(origin + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
  await expect(readInput(request, origin, 16384)).rejects.toMatchObject({ status: 413 });
  expect(cancelled).toBe(true);
  expect(reads).toBe(2);
});
it("accepts the exact byte limit and rejects excessive declarations before reading", async () => {
  const exact = '"' + "x".repeat(16382) + '"';
  expect(
    (
      (await readInput(
        new Request(origin, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: exact,
        }),
        origin,
        16384,
      )) as string
    ).length,
  ).toBe(16382);
  const request = new Request(origin, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "content-length": "16385" },
    body: "{}",
  });
  await expect(readInput(request, origin, 16384)).rejects.toMatchObject({ status: 413 });
  expect(request.bodyUsed).toBe(false);
});
