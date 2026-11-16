export function refusesAppWorker({
  production,
  framed,
  hostname,
  search,
}: {
  production: boolean;
  framed: boolean;
  hostname: string;
  search: string;
}) {
  return (
    !production ||
    framed ||
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    ["lovableproject.com", "lovableproject-dev.com", "beta.lovable.dev"].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    ) ||
    new URLSearchParams(search).get("sw") === "off"
  );
}
