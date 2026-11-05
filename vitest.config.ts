import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "virtual:pwa-register": path.resolve(__dirname, "./src/test/mocks/pwa-register.ts"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
