FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
# better-sqlite3 has no ready-made build for Alpine, so it is compiled here. These tools stay in this
# build stage; the final image only copies the finished node_modules.
RUN apk add --no-cache python3 make g++ \
 && npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ARG APP_VERSION=dev
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV APP_VERSION=$APP_VERSION GIT_COMMIT=$GIT_COMMIT BUILD_TIME=$BUILD_TIME
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY migrations ./migrations
# The database is one file. Mount a volume on /data so it survives the container being replaced.
ENV DATABASE_PATH=/data/notiforwarder.db
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
