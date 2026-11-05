export async function submissionRequest(path: string, body?: unknown) {
  const r = await fetch(path, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.message ?? "Request unavailable.");
  return v;
}
