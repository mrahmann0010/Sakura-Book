# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# ---- build: install the whole workspace, compile contracts then api ----
# npm ci runs in this stage rather than a separate deps stage that gets copied
# from: npm does not hoist every workspace dependency to the root. @nestjs/cli
# lands in apps/api/node_modules, so copying only /app/node_modules forward
# loses the `nest` binary and the build fails with `nest: not found`.
# All workspace manifests are copied because npm ci validates them against
# package-lock.json and refuses a partial set.
FROM base AS build
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY . .
# contracts first — apps/api imports @sakura/contracts, which resolves through a
# workspace symlink to packages/contracts/dist and does not exist until built.
RUN npm run build --workspace @sakura/contracts
RUN npm run build --workspace @sakura/api

# ---- prune: the same tree with devDependencies left out ----
FROM base AS prune
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev

# ---- runtime: compiled output on a production-only dependency tree ----
FROM base AS runtime
ENV NODE_ENV=production

# The whole pruned tree, not just the root node_modules — this preserves
# per-workspace node_modules and the node_modules/@sakura/contracts symlink
# that points at packages/contracts.
COPY --from=prune /app ./
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Railway injects PORT; main.ts reads it through ConfigService, so it is
# deliberately not pinned here. 4000 is only the documented local default.
EXPOSE 4000
CMD ["node", "apps/api/dist/main"]
