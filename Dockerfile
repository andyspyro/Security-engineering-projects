FROM node:20-bookworm-slim AS dependencies

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY secure-lofi-study-cafe/package.json ./

RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY secure-lofi-study-cafe/ ./

RUN mkdir -p /data \
    && chown -R node:node /app /data

ENV NODE_ENV=production
ENV DB_PATH=/data/lofi_cafe.db

USER node

EXPOSE 3000

CMD ["node", "server.js"]
