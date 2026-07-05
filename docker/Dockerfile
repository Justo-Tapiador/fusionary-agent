# FUSIONARY-AGENT v1.0 — Dockerfile (multi-stage)
# Stage 1: build / install deps
# Stage 2: minimal runtime image

FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

FROM node:20-slim AS runtime
WORKDIR /app
RUN useradd -m -u 1001 fusionary
COPY --from=builder /app /app
RUN mkdir -p /app/research /app/data && chown -R fusionary:fusionary /app
USER fusionary
ENV NODE_ENV=production
ENV FUSIONARY_RESEARCH_DIR=/app/research
ENV FUSIONARY_PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/status').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
CMD ["node", "web/server.js"]
