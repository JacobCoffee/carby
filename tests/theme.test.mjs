import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEME_OPTIONS, applyTheme, getStoredThemePreference, resolveTheme } from "../lib/theme.ts";

function installBrowser({ prefersDark = false } = {}) {
  const store = new Map();
  const meta = { content: "", setAttribute: (_name, value) => (meta.content = value) };
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
    },
    matchMedia: () => ({ matches: prefersDark }),
  };
  globalThis.document = {
    documentElement: { dataset: {} },
    querySelector: () => meta,
  };
  return { meta };
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

test("an AMOLED choice is stored, applied and survives a reload", () => {
  const { meta } = installBrowser({ prefersDark: false });
  applyTheme("amoled");
  assert.equal(getStoredThemePreference(), "amoled");
  assert.equal(document.documentElement.dataset.theme, "amoled");
  assert.equal(meta.content, "#000000");
  assert.equal(resolveTheme(getStoredThemePreference()), "amoled");
});

// A theme block that omits a token silently inherits the light value from :root, which is
// how white cards ended up inside dark themes. Every selectable theme must define the full set.
test("every selectable theme defines every color token", () => {
  const css = readFileSync(new URL("../app/theme.css", import.meta.url), "utf8");
  const tokensOf = (selector) => {
    const start = css.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `${selector} block is missing from theme.css`);
    const body = css.slice(start, css.indexOf("}", start));
    return new Set([...body.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]));
  };
  const expected = tokensOf('[data-theme="light"]');
  const selectors = [
    ":root:not([data-theme])",
    ...THEME_OPTIONS.filter((o) => o.value !== "system").map((o) => `[data-theme="${o.value}"]`),
  ];
  for (const selector of selectors) {
    const actual = tokensOf(selector);
    const missing = [...expected].filter((token) => !actual.has(token));
    const extra = [...actual].filter((token) => !expected.has(token));
    assert.deepEqual({ selector, missing, extra }, { selector, missing: [], extra: [] });
  }
});

// On screen, non-Light themes remap the clinician report onto their own tokens; printing must
// restore exactly the Light paper palette, or a PDF exported from a dark theme would differ.
test("printing restores every report token to the Light paper value", () => {
  const css = readFileSync(new URL("../app/theme.css", import.meta.url), "utf8");
  const reportTokens = (body) =>
    Object.fromEntries(
      [...body.matchAll(/--(report-[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]),
    );
  const blockAfter = (marker) => {
    const start = css.indexOf(marker);
    assert.notEqual(start, -1, `${marker} is missing from theme.css`);
    return css.slice(start, css.indexOf("}", start));
  };
  const paper = reportTokens(blockAfter(":root {"));
  const remap = ':root:not([data-theme="light"]) {';
  const screen = reportTokens(blockAfter(remap));
  const print = reportTokens(css.slice(css.lastIndexOf("@media print")).slice(0));
  assert.ok(Object.keys(paper).length > 0);
  assert.deepEqual(Object.keys(screen).sort(), Object.keys(paper).sort());
  assert.deepEqual(print, paper);
});
