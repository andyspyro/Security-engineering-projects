FROM node:20-bookworm-slim

WORKDIR /app

COPY secure-lofi-study-cafe/package.json ./

RUN npm install --omit=dev --no-audit --no-fund

COPY secure-lofi-study-cafe/ ./

RUN chown -R node:node /app

ENV NODE_ENV=production

USER node

EXPOSE 3000

CMD ["node", "server.js"]
