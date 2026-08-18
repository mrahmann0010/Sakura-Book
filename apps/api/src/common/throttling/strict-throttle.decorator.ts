import { Throttle } from "@nestjs/throttler";
import { STRICT_LIMIT, THROTTLE_DEFAULT } from "./throttler.config";

/**
 * The tight limit, for endpoints that answer "does this identifier exist?".
 *
 * Narrows the single global bucket for one route rather than adding a second
 * one — see throttler.config.ts for why a second named throttler would have
 * quietly applied the strict limit to the whole API, catalog included.
 */
export const StrictThrottle = (): MethodDecorator => Throttle({ [THROTTLE_DEFAULT]: STRICT_LIMIT });
