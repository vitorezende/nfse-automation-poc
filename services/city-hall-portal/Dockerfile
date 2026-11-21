FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/views ./views
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts /app/package.json ./
EXPOSE 3001
# Apply migrations and the idempotent seed, then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/main.js"]
