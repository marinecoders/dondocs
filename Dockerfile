# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Base path for Vite (default: / for Docker/Caddy, override for GitHub Pages)
ARG BASE_PATH=/

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application with configurable base path
RUN npx tsc -b && npx vite build --base=$BASE_PATH

# Production stage with Caddy
FROM caddy:2-alpine

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/caddy

# Copy Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Expose port 80
EXPOSE 80

# Caddy runs as the entrypoint by default