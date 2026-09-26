import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";

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
    plugins: [vinext(), ...(localSignIn ? [requireLoopbackDevServer()] : [])],
  };
});
