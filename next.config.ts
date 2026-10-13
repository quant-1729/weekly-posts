import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its own WASM and data files at runtime; do not bundle it.
  // resvg, harfbuzzjs and sharp ship native/WASM binaries and must stay external too.
  serverExternalPackages: ["@electric-sql/pglite", "@resvg/resvg-js", "harfbuzzjs", "sharp"],
  // The renderer reads the Noto fonts from assets/fonts at runtime; ship them with the route that renders.
  outputFileTracingIncludes: {
    "/api/posts/generate": ["./assets/fonts/**"],
    // Weekly generation (V-10): the hourly cron route, and the /week page whose "Generate now"
    // server action runs the same pipeline.
    "/api/cron/weekly": ["./assets/fonts/**"],
    "/week": ["./assets/fonts/**"],
    // Approval pages from emailed links (V-16): editing text, swapping the photo or rewriting
    // draws the post's images again.
    "/e/[token]": ["./assets/fonts/**"],
    // Choosing a mascot draws its character sheet, with the name set in Noto (V-25).
    "/mascot": ["./assets/fonts/**"],
  },
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
