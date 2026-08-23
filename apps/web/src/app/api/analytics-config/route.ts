import { gaMeasurementId } from "@/lib/analytics";

/**
 * The Google Analytics measurement ID, read at request time.
 *
 * This route exists because of *when* the ID is read, not because the browser
 * could not have been handed it directly. Rendering it into the page from the
 * layout is simpler and was the first shape of this — but every storefront
 * route is statically prerendered, so that read happens during `next build`,
 * and a deployment that can only set environment variables on the running
 * container has no way to get a value into it. The pages ship with no tag and
 * nothing about the running container can change that.
 *
 * A route handler is the way out: `force-dynamic` means it is never
 * prerendered, so `process.env` here is the environment of the *running*
 * server. Set G_ANALYTICS in the container's env, restart, and analytics is
 * on — no rebuild, no build argument.
 *
 * It costs one small same-origin request before the tag loads. That is the
 * whole price, and it buys a deploy that works with the access an ordinary
 * hosting panel gives you. This is the same trade the payment numbers already
 * make by coming from `GET /payments/numbers` rather than a baked-in env var.
 *
 * The ID is not a secret — it ships in the page source of every GA site on the
 * web — so there is nothing to protect here beyond not inventing a value when
 * there isn't one.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { measurementId: gaMeasurementId() ?? null },
    {
      /* A CDN or proxy caching this would pin the ID for everyone until the
         cache expired, which is exactly the redeploy-free change this route
         exists to allow. */
      headers: { "Cache-Control": "no-store" },
    },
  );
}
