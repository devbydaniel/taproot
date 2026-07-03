FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    TAPROOT_DB=/data/taproot.db \
    PORT=3000
COPY --from=build /app /app
VOLUME /data
EXPOSE 3000
CMD ["npm", "run", "start"]
