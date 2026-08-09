import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle for the production Docker image.
  output: "standalone",
  // Monorepo root, so file tracing picks up hoisted node_modules.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
