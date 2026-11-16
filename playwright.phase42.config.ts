import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  maxFailures: 1,
  testMatch: "phase42.spec.ts",
  outputDir: ".local/phase42-browser-results",
  reporter: [["list"], ["json", { outputFile: ".local/phase42-browser-report.json" }]],
});
