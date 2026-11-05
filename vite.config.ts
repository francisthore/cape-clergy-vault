import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    tanstackStart({ server: { entry: "server" } }),
    ...(command === "build" ? [nitro({ preset: "node-server" })] : []),
    react(),
    VitePWA({
      strategies: "generateSW",
      outDir: ".output/public",
      filename: "sw.js",
      registerType: "autoUpdate",
      injectRegister: null,
      devOptions: { enabled: false },
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,png,ico,webmanifest}"],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              /\/assets\/.*-[\w-]{8,}\.(js|css|png|woff2)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "teft-hashed-assets",
              expiration: { maxEntries: 100, maxAgeSeconds: 2592000 },
            },
          },
        ],
        cleanupOutdatedCaches: true,
        importScripts: ["/sw-cleanup.js"],
      },
    }),
  ],
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
}));
