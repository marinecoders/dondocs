# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Base path for Vite (default: / for Docker/Caddy, override for GitHub Pages)
ARG BASE_PATH=/

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Vendor the pandoc WASM parts BEFORE copying source, so the ~58MB download
# layer-caches until the vendor script itself changes — not on every source
# edit. The script uses only Node builtins, so it needs no app source.
COPY scripts ./scripts
RUN node scripts/vendor-assets.mjs

# Copy source code (.dockerignore excludes the gitignored pandoc artifacts, so
# this can't clobber the freshly-vendored parts with a dev machine's stale ones).
COPY . .

# Build via npm so BOTH lifecycle hooks run: prebuild (an idempotent re-vendor —
# a no-op given the cached parts) and, critically, postbuild (the check-no-cdn
# air-gap guard). Invoking vite directly here was the one build path that shipped
# the release image unscanned. npm appends trailing args to the last command in
# the build script, so --base lands on `vite build`.
RUN npm run build -- --base=$BASE_PATH

# Production stage with Caddy
FROM caddy:2-alpine

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/caddy

# Copy Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Expose port 80
EXPOSE 80

# Caddy runs as the entrypoint by default