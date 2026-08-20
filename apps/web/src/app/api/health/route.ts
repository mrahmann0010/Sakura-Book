/**
 * Container liveness probe. Under /api rather than at /health because
 * proxy.ts's matcher excludes exactly that prefix from locale detection — a
 * top-level /health is redirected to /en/health before it is ever served, and
 * the probe reads that 307 chain instead of the app's actual state.
 *
 * The obvious probe target is `/`, and it is the wrong one: the home page
 * server-renders the catalogue, so it answers 500 whenever the API is
 * unreachable. Pointed at that, Docker marks the frontend unhealthy — and a
 * restart policy or orchestrator then restarts it — because a *different*
 * service is down, which no amount of restarting the frontend fixes.
 *
 * This route answers the only question a liveness probe should ask: is the
 * Next server process able to respond at all? Readiness, in the sense of
 * "can this instance render a useful page", belongs to the API's own
 * /api/health/ready — see apps/api/src/health/health.controller.ts.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
