import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser",
  fullyParallel: false,
  workers: 1,
  timeout: 150000,
  expect: { timeout: 15000 },
  outputDir: ".local/browser-results",
  reporter: [["list"], ["json", { outputFile: ".local/browser-report.json" }]],
  use: {
    baseURL: "http://localhost:3220",
    actionTimeout: 15000,
    navigationTimeout: 15000,
    browserName: "chromium",
    channel: "chromium",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    { name: "small-mobile", use: { viewport: { width: 320, height: 740 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: "node browser/server.ts",
    url: "http://localhost:3220/health/live",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
