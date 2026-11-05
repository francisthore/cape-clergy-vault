// Remove navigation responses cached by older workers; they may contain private HTML.
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete("teft-public-navigations"));
});
