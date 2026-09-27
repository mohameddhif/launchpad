FROM node:22-alpine
WORKDIR /repo

# openssl: Alpine ships no libssl at all, which breaks Prisma's engine detection/dlopen
# (see apps/api/Dockerfile for the full explanation). git: needed to clone deploy repos
# at a specific commit; docker CLI is not required — dockerode talks to the mounted
# socket directly over the Engine API.
RUN apk add --no-cache openssl git

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

COPY packages/shared packages/shared
COPY apps/worker apps/worker
COPY apps/nginx-templates apps/nginx-templates
RUN npx prisma generate --schema packages/shared/prisma/schema.prisma

WORKDIR /repo/apps/worker
CMD ["npx", "tsx", "watch", "src/index.ts"]
