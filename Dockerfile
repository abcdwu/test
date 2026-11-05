FROM node:24-alpine
WORKDIR /app
COPY package.json common.js mistake-store.js progress.js ./
COPY server/ ./server/
ENV NODE_ENV=production PORT=8080 DATABASE_PATH=/data/mistakes.sqlite
EXPOSE 8080
CMD ["node", "server/start.js"]
