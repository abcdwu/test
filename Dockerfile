FROM node:24-alpine
WORKDIR /app
COPY package.json common.js mistake-store.js progress.js highlight-core.js ./
COPY server/ ./server/
COPY index.html mistakes.html highlights.js highlight-core.js styles.css common.js bank-loader.js practice.js mistakes.js browser-store.js mistake-store.js progress.js cloud-sync.js pdf-source.js cloud-config.json ./public/
COPY bank/ ./public/bank/
COPY sources/ ./public/sources/
COPY vendor/pdfjs/ ./public/vendor/pdfjs/
ENV NODE_ENV=production PORT=8080 DATABASE_PATH=/data/mistakes.sqlite STATIC_DIRECTORY=/app/public
EXPOSE 8080
CMD ["node", "server/start.js"]
