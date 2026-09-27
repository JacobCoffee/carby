/**
 * Tesseract.js loads its worker, engine and language data by file name, so vite.config.ts
 * serves them from these paths instead of the jsDelivr CDN it would use by default. They sit
 * under /_next/static because the production server serves build files only from there, cached
 * as immutable; the versions in the paths keep an upgrade from meeting an old cached file, and
 * the config refuses to start when they no longer match what is installed.
 */
export const OCR_VERSIONS = {
  "tesseract.js": "7.0.0",
  "tesseract.js-core": "7.0.0",
  "@tesseract.js-data/eng": "1.0.0",
} as const;

export const OCR_BASE = "/_next/static/ocr";
export const OCR_WORKER_DIR = `${OCR_BASE}/worker-${OCR_VERSIONS["tesseract.js"]}`;
export const OCR_CORE_DIR = `${OCR_BASE}/core-${OCR_VERSIONS["tesseract.js-core"]}`;
export const OCR_LANG_DIR = `${OCR_BASE}/eng-${OCR_VERSIONS["@tesseract.js-data/eng"]}`;

/** Served path → file inside an installed package. LSTM-only engines, as Carby never uses the legacy one. */
export const OCR_FILES: Record<string, { pkg: keyof typeof OCR_VERSIONS; file: string }> = {
  [`${OCR_WORKER_DIR}/worker.min.js`]: { pkg: "tesseract.js", file: "dist/worker.min.js" },
  ...Object.fromEntries(
    ["lstm", "simd-lstm", "relaxedsimd-lstm"].map((variant) => [
      `${OCR_CORE_DIR}/tesseract-core-${variant}.wasm.js`,
      { pkg: "tesseract.js-core" as const, file: `tesseract-core-${variant}.wasm.js` },
    ]),
  ),
  // Still gzipped: Tesseract checks the bytes and unpacks them. The name drops ".gz" because the
  // production server takes a .gz file for a compressed copy of another file and won't serve it.
  [`${OCR_LANG_DIR}/eng.traineddata`]: {
    pkg: "@tesseract.js-data/eng",
    file: "4.0.0_best_int/eng.traineddata.gz",
  },
};
