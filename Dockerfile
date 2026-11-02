# Telegram bot image. Build from the repository root:
#   docker build -t wordlearning-bot .
FROM node:22-alpine
WORKDIR /app
COPY js/srs.js js/srs.js
COPY bot/package.json bot/package-lock.json bot/
RUN cd bot && npm ci --omit=dev
COPY bot/src bot/src
WORKDIR /app/bot
ENV NODE_ENV=production
USER node
CMD ["node", "src/index.js"]
