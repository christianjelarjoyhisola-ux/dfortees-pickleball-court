const { copyFileSync, mkdirSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");

const projectRoot = resolve(__dirname, "..");
const outputDirectory = join(projectRoot, "dist");
const publicFiles = [
  "_headers",
  "_worker.js",
  "admin.html",
  "booking-balance.js",
  "brand-config.js",
  "brand.css",
  "chart.min.js",
  "dforteesspash.jpg",
  "host.html",
  "index.html",
  "login.html",
  "logodfortees.jpg",
  "supabase-config.js",
  "supabase.min.js",
];

rmSync(outputDirectory, { force: true, recursive: true });
mkdirSync(outputDirectory, { recursive: true });

for (const file of publicFiles) {
  copyFileSync(join(projectRoot, file), join(outputDirectory, file));
}

console.log(`Prepared ${publicFiles.length} public files in ${outputDirectory}.`);
