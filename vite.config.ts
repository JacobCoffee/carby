import { createReadStream, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";
import { OCR_FILES, OCR_VERSIONS } from "./lib/ocr-assets";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
// Vite's default exclusions, plus the local sign-in secret, which the dev server must never serve.
const deniedFiles = [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.carby-local/**"];

function requireLoopbackDevServer(): Plugin {
  return {
    name: "carby:loopback-dev-server",
    configResolved({ server }) {
      const host = server.host ?? "localhost";
      if (typeof host === "string" && loopbackHosts.has(host)) return;
      throw new Error("Local sign-in is enabled, so the dev server must listen on localhost only.");
    },
  };
}

/** Serves Tesseract's files at the fixed paths in lib/ocr-assets.ts, in dev and in the build. */
function ocrAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const files = new Map<string, string>();
  for (const [pkg, version] of Object.entries(OCR_VERSIONS)) {
    const manifest = require.resolve(`${pkg}/package.json`);
    const installed = (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
    if (installed !== version)
      throw new Error(`${pkg} is ${installed}; update OCR_VERSIONS in lib/ocr-assets.ts to match.`);
  }
  for (const [url, { pkg, file }] of Object.entries(OCR_FILES))
    files.set(url, path.join(path.dirname(require.resolve(`${pkg}/package.json`)), file));
  return {
    name: "carby:ocr-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = files.get((req.url ?? "").split("?")[0]);
        if (!file) return next();
        res.setHeader(
          "Content-Type",
          file.endsWith(".js") ? "text/javascript" : "application/octet-stream",
        );
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      if (this.environment.name !== "client") return;
      for (const [url, file] of files)
        this.emitFile({ type: "asset", fileName: url.slice(1), source: readFileSync(file) });
    },
  };
}

export default defineConfig(({ command }) => {
  // scripts/local-runtime.mjs sets these for `make serve`. A build never receives them.
  const localSignIn =
    command === "serve" &&
    process.env.CARBY_AUTH_MODE === "local" &&
    process.env.CARBY_LOCAL_LAUNCHER === "1";
  return {
    server: { fs: { deny: deniedFiles } },
    environments: {
      client: {
        optimizeDeps: {
          // vinext excludes vinext/shims/link, but Vite matches the import specifier, so the
          // next/* aliases still bundle link.js, navigation.js and their "use client" prefetch
          // queue. The RSC reference loads that queue raw, giving the browser two copies of the
          // queue and router state. Loading these shims raw keeps one copy.
          exclude: ["next/link", "next/navigation"],
        },
      },
    },
    plugins: [vinext(), ocrAssets(), ...(localSignIn ? [requireLoopbackDevServer()] : [])],
  };
});
