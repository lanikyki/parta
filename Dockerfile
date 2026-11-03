# Сборка и запуск сайта «Парта» в Docker
FROM node:22-alpine AS build
WORKDIR /app
# Те же версии библиотек, что проверены на компьютере (package-lock.json есть в архиве проекта;
# если его нет, например в копии с GitHub, — обычная установка)
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts --no-audit --no-fund; \
    else npm install --ignore-scripts --no-audit --no-fund; fi
COPY . .
RUN node scripts/copy-pdf-worker.cjs && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    PGLITE_DIR=/app/data/db
COPY --from=build /app/package.json ./
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# Здесь хранится встроенная база (если не указан DATABASE_URL)
VOLUME /app/data
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
