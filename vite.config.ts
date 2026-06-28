import { defineConfig } from "vite";

// base: './' keeps asset URLs relative so the built app loads correctly from
// the file:// scheme inside the Capacitor Android WebView.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsInlineLimit: 8192,
  },
  server: {
    host: true,
    port: 5173,
  },
});
