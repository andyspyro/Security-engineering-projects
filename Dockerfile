FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY secure-lofi-study-cafe/package.json ./

RUN npm install --omit=dev --no-audit --no-fund

COPY secure-lofi-study-cafe/ ./

RUN mkdir -p /app/data \
    && chown -R node:node /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DB_PATH=/app/data/lofi_cafe.db

USER node

EXPOSE 3000

CMD ["node", "server.js"]
