# Dev-weight image: runs TypeScript directly via tsx rather than a compiled build.
# Simple and fast to iterate on for a portfolio-scale deploy; a real production image
# would add a multi-stage compile + prune step.
FROM node:22-alpine
WORKDIR /repo

# Alpine's base image ships no libssl at all (Node statically links its own), so Prisma's
# engine-detection can't identify an OpenSSL version and silently grabs the wrong prebuilt
# query engine. Installing openssl fixes detection at generate time and satisfies the
# engine binary's runtime dlopen.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npx prisma generate --schema packages/shared/prisma/schema.prisma

WORKDIR /repo/apps/api
EXPOSE 4000
# Dev-mode watch: src/ is bind-mounted over this in docker-compose.yml, so host edits
# reload without an image rebuild. CI/prod would swap this for a compiled `node dist/index.js`.
CMD ["npx", "tsx", "watch", "src/index.ts"]
