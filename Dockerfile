# syntax=docker/dockerfile:1
# Weekly Posts on Cloud Run (C-31). Build: docker build -t weekly-posts .   Run: see docs/deploy.md.
# Debian (not Alpine) so the prebuilt sharp and resvg binaries (glibc) work.

ARG NODE_VERSION=24

# 1. Dependencies (cached while package*.json is unchanged).
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2. Build the standalone server. NEXT_PUBLIC_* values are baked into the browser code here, so they
#    are build arguments (cloudbuild.yaml passes them); they are public by design. No secrets are needed to build.
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_APP_URL=
ARG NEXT_PUBLIC_SUPABASE_URL=
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 3. Runtime: only the traced server, the static files, public/ and the Noto fonts.
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# The renderer reads fonts from process.cwd()/assets/fonts (src/lib/render/shape.ts); server.js runs with
# /app as its working directory, so they must sit here for every route, not only the traced ones.
COPY --from=build --chown=node:node /app/assets/fonts ./assets/fonts
# sharp's native files are loaded by path, which the tracer misses (it copies the .node but not libvips), so
# take the whole @img folder; `npm ci` above installed the linux-x64 variants.
COPY --from=build --chown=node:node /app/node_modules/@img ./node_modules/@img
# Proves the shipped fonts, HarfBuzz (wasm), resvg and sharp (native) work from /app. A failure stops the build.
COPY --chown=node:node scripts/smoke-render.mjs ./smoke-render.mjs
RUN node smoke-render.mjs
USER node
EXPOSE 8080
# Cloud Run sets PORT (8080); server.js listens on it.
CMD ["node", "server.js"]
