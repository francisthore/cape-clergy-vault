import { refusesAppWorker } from "@/lib/pwa-safety";
export async function registerAppWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (
    refusesAppWorker({
      production: import.meta.env.PROD,
      framed: window.top !== window.self,
      hostname: location.hostname,
      search: location.search,
    })
  ) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((r) =>
          [r.active, r.waiting, r.installing].some(
            (w) => w && new URL(w.scriptURL).pathname === "/sw.js",
          ),
        )
        .map((r) => r.unregister()),
    );
    return;
  }
  const { registerSW } = await import("virtual:pwa-register");
  registerSW({ immediate: true });
}
