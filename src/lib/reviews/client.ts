export async function reviewRequest(body?: unknown, query = "") {
  const response = await fetch(`/api/reviewer${query}`, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(Error(data.message ?? "Review unavailable."), { status: response.status });
  return data;
}
