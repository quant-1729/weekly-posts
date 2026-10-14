import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run (C-31): "next build" writes a self-contained server to .next/standalone (server.js plus
  // only the node_modules it needs); the Dockerfile copies that, .next/static, public and assets/fonts.
  output: "standalone",
  poweredByHeader: false,
  // Security headers on every response. Framing is refused (no page is meant to be embedded); the microphone
  // stays allowed for this site only, for voice input on the brief.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
    ];
  },
  // "next build" type-checks only the app (src/), not tests/ or scripts/, so the Docker image does not need
  // them. "npm run typecheck" still checks everything with tsconfig.json.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  // PGlite loads its own WASM and data files at runtime; do not bundle it.
  // resvg, harfbuzzjs and sharp ship native/WASM binaries and must stay external too.
  // @google-cloud/storage (C-32) is external too: it has many dynamic requires that bundling breaks.
  serverExternalPackages: ["@electric-sql/pglite", "@resvg/resvg-js", "harfbuzzjs", "sharp", "@google-cloud/storage"],
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
    // The v3 design engine (src/lib/design) draws posts on /create and in the design API routes; it reads the 5 font roles
    // (Noto Sans, Playfair Display, Nunito, Oswald, Archivo Black) plus the Noto Devanagari and Arabic fallbacks from here.
    "/create": ["./assets/fonts/**"],
    // The design step draws the three option previews and, on "Use this design", every size; the review step draws
    // the pictures again when a flagged phrase is removed from the headline (src/lib/create).
    "/create/[briefId]/design": ["./assets/fonts/**"],
    "/create/[briefId]/review": ["./assets/fonts/**"],
    "/api/design/render": ["./assets/fonts/**"],
    "/api/posts/design": ["./assets/fonts/**"],
    // The brand page draws the text logo (C-19) and its font samples are served by /api/fonts.
    "/brand": ["./assets/fonts/**"],
    "/api/fonts/[file]": ["./assets/fonts/**"],
  },
  // Never ship these in the standalone output: the Tween vendor kit (reference art only), local mock
  // data, tests and the build's own cache. PGlite (about 21 MB) is left out too: src/lib/db/mock.ts imports
  // it only when a mock database is created, and the mock backend is refused in hosted production.
  outputFileTracingExcludes: {
    "*": ["./vendor/**", "./.data/**", "./test-data/**", "./test-results/**", "./tests/**", "./docs/**", "./.git/**", "./node_modules/@electric-sql/pglite/**"],
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
