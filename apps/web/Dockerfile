# syntax=docker/dockerfile:1.7

# One place to bump Node, and a digest-pinned base so a rebuild months from now
# resolves the same bytes — `node:20-alpine` is a moving tag, and a silent minor
# bump between the build and the rollback you reach for is the worst time to
# discover it moved.
ARG NODE_VERSION=20.20-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Every workspace manifest, not just the ones this image builds: npm ci
# validates the full set against package-lock.json and refuses a partial one
# with "Missing: @sakura/api from lock file".
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json

# The cache mount keeps npm's tarball cache on the builder between builds, so a
# lockfile change re-links the tree instead of re-downloading it. It lives
# outside the image, so nothing here reaches the final layers.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

# ---------- builder ----------
# Continues from deps rather than copying /app/node_modules out of it: npm does
# not hoist every workspace dependency to the root. @hookform/resolvers lands in
# apps/web/node_modules, and an image that carries only the root tree forward
# fails the build with "Can't resolve '@hookform/resolvers/zod'". Building on
# top of deps costs nothing — the install layer is shared either way.
FROM deps AS builder

# Copied by path rather than `COPY . .` so that editing the API does not
# invalidate the web build cache. Contracts first and on its own layer: it
# changes far less often than app code, so its compile is usually a cache hit.
COPY package.json package-lock.json turbo.json ./
COPY packages/contracts packages/contracts
RUN npm run build --workspace @sakura/contracts

COPY apps/web apps/web

# Next.js inlines every NEXT_PUBLIC_* var into the client bundle at build
# time, not at container start — an ENV set on the running container never
# reaches code that already shipped without it. The build step must be given
# it explicitly via --build-arg, or every deployed page loads with the API
# origin baked in as undefined.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# G_ANALYTICS is deliberately NOT a build arg. It is served at request time by
# app/api/analytics-config/route.ts, so setting it on the running container is
# enough and a rebuild is not — which is the point: the ID can be added, changed
# or removed from a hosting panel by someone who cannot run a docker build.
RUN npm run build --workspace @sakura/web

# ---------- runner ----------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# dumb-init as PID 1. Node run directly as PID 1 gets no default SIGTERM
# handler, so `docker stop` waits out the full 10s grace period and then SIGKILLs
# mid-request on every single deploy. This is the difference between a rolling
# restart that drains and one that drops connections.
RUN apk add --no-cache dumb-init \
 && addgroup -g 1001 -S nodejs \
 && adduser -S nextjs -u 1001

# outputFileTracingRoot is the monorepo root, so the standalone server lands
# at apps/web/server.js and resolves public/ relative to that same directory
# — it must be copied to apps/web/public, not the image's top-level ./public,
# or every request for a static asset in /public 404s.
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

# No curl in the image and no reason to add one — Node can call itself.
# /api/health, not `/`: the home page renders the catalogue and so returns 500 when
# the API is down, which would mark this container unhealthy for another
# service's outage. See apps/web/src/app/api/health/route.ts.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
