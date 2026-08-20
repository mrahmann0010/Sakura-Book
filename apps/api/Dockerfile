# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=20.18-alpine

FROM node:${NODE_VERSION} AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# ---- manifests: the one layer both installs share ----
# Split out so the two npm ci stages below start from the same cached layer and
# only re-run when a package.json actually changes. All workspace manifests are
# copied because npm ci validates them against package-lock.json and refuses a
# partial set.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

# ---- build: install the whole workspace, compile contracts then api ----
# npm ci runs in this stage rather than a separate deps stage that gets copied
# from: npm does not hoist every workspace dependency to the root. @nestjs/cli
# lands in apps/api/node_modules, so copying only /app/node_modules forward
# loses the `nest` binary and the build fails with `nest: not found`.
FROM manifests AS build
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

# contracts first — apps/api imports @sakura/contracts, which resolves through a
# workspace symlink to packages/contracts/dist and does not exist until built.
# Its sources are copied ahead of the API's so that ordinary API edits reuse
# this layer instead of recompiling contracts.
COPY turbo.json ./
COPY packages/contracts packages/contracts
RUN npm run build --workspace @sakura/contracts

COPY apps/api apps/api
RUN npm run build --workspace @sakura/api

# ---- prune: the same tree with devDependencies and the web app left out ----
# Scoped to the two workspaces the runtime actually loads. Without the
# --workspace flags this installs the web app's production tree as well — next,
# react, three Tailwind packages — several hundred megabytes shipped in an image
# that never serves a page. --include-workspace-root keeps the root manifest's
# own deps and the node_modules/@sakura/* symlinks intact.
FROM manifests AS prune
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --no-audit --no-fund \
      --include-workspace-root \
      --workspace @sakura/api \
      --workspace @sakura/contracts

# ---- runtime: compiled output on a production-only dependency tree ----
FROM base AS runtime
ENV NODE_ENV=production

# dumb-init reaps zombies and forwards SIGTERM. NestJS calls
# enableShutdownHooks() in main.ts, but a process that never receives the signal
# never runs them — connections are killed rather than drained on every deploy.
RUN apk add --no-cache dumb-init \
 && addgroup -g 1001 -S nodejs \
 && adduser -S nestjs -u 1001

# The whole pruned tree, not just the root node_modules — this preserves
# per-workspace node_modules and the node_modules/@sakura/contracts symlink
# that points at packages/contracts.
COPY --from=prune --chown=nestjs:nodejs /app ./
COPY --from=build --chown=nestjs:nodejs /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=nestjs:nodejs /app/apps/api/dist ./apps/api/dist

USER nestjs

# Railway injects PORT; main.ts reads it through ConfigService, so it is
# deliberately not pinned here. 4000 is only the documented local default.
EXPOSE 4000

# Liveness, not readiness: this probe must not fail because Postgres blinked,
# or Docker restarts a perfectly healthy container. See health.controller.ts.
# The v1 segment is not optional — main.ts enables URI versioning with
# defaultVersion "1", so the unversioned /api/health 404s.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/main"]
