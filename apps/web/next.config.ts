import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle for the production Docker image —
  // apps/web/Dockerfile's runner stage copies .next/standalone and runs
  // server.js from it. Vercel is the exception: it runs its own file-tracing
  // and output pipeline, and combining standalone with outputFileTracingRoot
  // there makes the tracer look for .nft.json files outside the directory it
  // expects, failing the build. VERCEL is set on every Vercel build.
  output: process.env.VERCEL ? undefined : "standalone",
  // Monorepo root, so file tracing picks up hoisted node_modules.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  experimental: {
    // The root layout lives under a top-level dynamic segment ([locale]),
    // so there's no single layout to compose a 404 from — global-not-found
    // is the documented way out for that shape.
    globalNotFound: true,
  },
};

export default nextConfig;
