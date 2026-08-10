FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies.
#
# `npm install`, not `npm ci`: package-lock.json is deliberately gitignored in
# this repo, so `npm ci` — which requires a lockfile and exits non-zero without
# one — could never succeed from a clean checkout. The single runtime dependency
# is `ws`, pinned by a caret range, so resolving at build time is acceptable
# here; if the lockfile is ever committed, switch back to `npm ci --omit=dev`
# for reproducible builds.
#
# `--omit=dev` supersedes the deprecated `--only=production`.
RUN npm install --omit=dev

# Copy source
COPY . .

# Expose port (REST API and WebSocket share a single port)
EXPOSE 8765

# Health check via REST API (same port as WebSocket)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8765/health || exit 1

# Run broker
CMD ["node", "server.js"]
