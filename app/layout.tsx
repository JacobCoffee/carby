import type { Metadata } from "next";
import "./theme.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carby · Daily care",
  description: "A private place for glucose readings, meals, insulin and your care plan.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The inline script below sets data-theme before React hydrates; only this element's
    // attributes are exempt from the mismatch check.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#f5f7fc" />
        <script
          // Runs before paint so a saved Dark/Blood/AMOLED/Sugar preference never flashes the default
          // light theme. "System" is left unset here: theme.css already follows
          // prefers-color-scheme with zero JS and zero flash for that case.
          dangerouslySetInnerHTML={{
            __html: `(function () {
              try {
                var pref = localStorage.getItem("carby-theme");
                if (pref === "light" || pref === "dark" || pref === "blood" || pref === "amoled" || pref === "sugar") {
                  document.documentElement.dataset.theme = pref;
                } else if (pref === "system" || !pref) {
                  var dark = matchMedia("(prefers-color-scheme: dark)").matches;
                  document.documentElement.dataset.theme = dark ? "dark" : "light";
                }
                var colors = { light: "#f5f7fc", dark: "#0a0c11", blood: "#0d0606", amoled: "#000000", sugar: "#fdf3f6" };
                var resolved = document.documentElement.dataset.theme;
                var meta = document.querySelector('meta[name="theme-color"]');
                if (meta && resolved && colors[resolved]) meta.setAttribute("content", colors[resolved]);
              } catch (e) {}
            })();`,
          }}
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
