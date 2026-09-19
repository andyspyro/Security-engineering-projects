FROM node:20-bookworm-slim AS dependencies

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY secure-lofi-study-cafe/package.json ./

RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

COPY --from=dependencies /app/node_modules ./node_modules
COPY secure-lofi-study-cafe/ ./

RUN chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /data \
    && chown node:node /data

ENV NODE_ENV=production
ENV DB_PATH=/data/lofi_cafe.db

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
