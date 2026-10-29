import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Capacitor packages only what the app actually loads. Raw GeoJSON used by
// tools/build_data.py stays out of the APK to keep it small.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB = join(ROOT, "www");

const FILES = [
  "index.html",
  "styles.css",
  "app.js",
  "native-share.js",
  "lib/echarts.min.js",
  "data/app-data.js",
  "assets/og-cover.png",
];

await rm(WEB, { recursive: true, force: true });
await mkdir(WEB, { recursive: true });

for (const relative of FILES) {
  const target = join(WEB, relative);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(ROOT, relative), target);
}

console.log(`Prepared ${FILES.length} files in www/`);
