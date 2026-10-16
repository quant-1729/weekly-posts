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

# 2b. Offline city/country lookup for sign-in sessions: the DB-IP "IP to City Lite" database (CC BY 4.0, "IP geolocation
#     by DB-IP"). GEOIP_MONTH pins the month (blank = the current month); the script falls back to the previous two
#     months and never fails the build: with no file the app just records no city or country.
FROM node:${NODE_VERSION}-bookworm-slim AS geoip
ARG GEOIP_MONTH=
WORKDIR /geoip-src
COPY scripts/fetch-geoip.mjs ./fetch-geoip.mjs
RUN mkdir -p /geoip && node fetch-geoip.mjs /geoip/dbip-city-lite.mmdb "$GEOIP_MONTH"

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
# The geolocation database (may be missing if the download failed; the app copes). GEOIP_DB_PATH tells the app where it is.
COPY --from=geoip --chown=node:node /geoip ./geoip
ENV GEOIP_DB_PATH=/app/geoip/dbip-city-lite.mmdb
# Proves the shipped fonts, HarfBuzz (wasm), resvg and sharp (native) work from /app. A failure stops the build.
COPY --chown=node:node scripts/smoke-render.mjs ./smoke-render.mjs
RUN node smoke-render.mjs
USER node
EXPOSE 8080
# Cloud Run sets PORT (8080); server.js listens on it.
CMD ["node", "server.js"]
