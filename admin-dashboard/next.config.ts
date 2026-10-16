import type { NextConfig } from "next";

// Security headers that do not depend on a per-request value. The Content-Security-Policy (it carries a nonce) is set
// in src/proxy.ts.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Cloud Run image: a self-contained server (node server.js) without the full node_modules.
  output: "standalone",
  reactStrictMode: true,
  // This folder is its own project (own lockfile); do not let Next pick the parent repo as the workspace root.
  turbopack: { root: process.cwd() },
  // pg uses Node networking; keep it out of the bundle.
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
