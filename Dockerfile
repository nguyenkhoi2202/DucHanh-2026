# ---- Build: frontend (Vite) + server (esbuild) ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime ----
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/duchanh.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

# SQLite database lives in a volume so it survives container rebuilds
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/api/me').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist-server/index.js"]
