FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source
COPY . .

# Expose port (REST API and WebSocket share a single port)
EXPOSE 8765

# Health check via REST API (same port as WebSocket)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8765/health || exit 1

# Run broker
CMD ["node", "server.js"]
