FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build


FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# Génère le Prisma Client dans le node_modules du conteneur final
RUN npx prisma generate

EXPOSE 3004

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]