// Copies the free OCR engine (Tesseract) and its English data from node_modules into public/ocr,
// so the browser loads everything from your own site and nothing is fetched from a third party.
// Runs automatically before `npm run dev` and `npm run build` (see package.json), and can be run by hand:
//   npm run ocr:assets

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const modules = path.join(root, "node_modules");
const outDir = path.join(root, "public", "ocr");
const langDir = path.join(outDir, "lang");

let missing = false;

function copy(from, to) {
  if (existsSync(to) && statSync(to).size === statSync(from).size) return false;
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
  return true;
}

function warn(message) {
  missing = true;
  console.warn(`[ocr-assets] ${message}`);
}

// 1. The worker script
const worker = path.join(modules, "tesseract.js", "dist", "worker.min.js");
if (existsSync(worker)) copy(worker, path.join(outDir, "worker.min.js"));
else warn("tesseract.js is not installed (node_modules/tesseract.js/dist/worker.min.js not found). Run: npm install");

// 2. The engine (WebAssembly) files; the browser picks the fastest one it supports
const coreDir = path.join(modules, "tesseract.js-core");
if (existsSync(coreDir)) {
  const files = readdirSync(coreDir).filter((name) => /^tesseract-core.*\.(js|wasm)$/.test(name));
  if (files.length === 0) warn("No tesseract-core files were found in node_modules/tesseract.js-core.");
  for (const name of files) copy(path.join(coreDir, name), path.join(outDir, name));
} else {
  warn("tesseract.js-core is not installed. Run: npm install");
}

// 3. English language data
function findFile(dir, name, preferred) {
  if (!existsSync(dir)) return null;
  const hits = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === name) hits.push(full);
    }
  };
  walk(dir);
  return hits.find((hit) => hit.includes(preferred)) ?? hits[0] ?? null;
}

const english = findFile(path.join(modules, "@tesseract.js-data", "eng"), "eng.traineddata.gz", "4.0.0_best_int");
if (english) copy(english, path.join(langDir, "eng.traineddata.gz"));
else warn("English OCR data was not found. Run: npm install @tesseract.js-data/eng");

console.log(missing ? "[ocr-assets] Some files are missing, so scanning of scanned pages and pictures will not work until they are installed." : "[ocr-assets] OCR files are ready in public/ocr.");
