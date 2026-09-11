FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    PROCESSED_DIR=/processed \
    MANGA_DIR=/manga
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /data /processed \
    && chown -R node:node /data /processed
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
    CMD node -e "\
      fetch('http://127.0.0.1:3000/api/health') \
        .then(r => process.exit(r.ok ? 0 : 1)) \
        .catch(() => process.exit(1))"
CMD ["node_modules/.bin/tsx", "server/index.ts"]
