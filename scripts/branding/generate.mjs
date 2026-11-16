// Deterministic derivatives of the owner-supplied crest; no artwork generation.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
const root = new URL("../../public/", import.meta.url);
const source = await readFile(new URL("dct-crest-source.png", root));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [name, width, height, padding] of [
    ["dct-crest-header.png", 140, 192, 0],
    ["favicon.png", 32, 32, 2],
    ["apple-touch-icon.png", 180, 180, 20],
    ["app-icon-192.png", 192, 192, 24],
    ["app-icon-512.png", 512, 512, 64],
  ]) {
    const encoded = await page.evaluate(
      async ({ source, width, height, padding }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${source}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw Error("Canvas unavailable");
        // White backing protects the colours on any OS theme; header keeps transparency.
        if (padding) {
          context.fillStyle = "white";
          context.fillRect(0, 0, width, height);
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        const scale = Math.min(
          (width - padding * 2) / img.width,
          (height - padding * 2) / img.height,
        );
        context.drawImage(
          img,
          (width - img.width * scale) / 2,
          (height - img.height * scale) / 2,
          img.width * scale,
          img.height * scale,
        );
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { source: source.toString("base64"), width, height, padding },
    );
    await writeFile(new URL(name, root), Buffer.from(encoded, "base64"));
    console.log(`${name}: ${width} × ${height}`);
  }
} finally {
  await browser.close();
}
