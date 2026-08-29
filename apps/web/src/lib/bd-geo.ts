/* --------------------------------------------------------------------------
   Bangladesh administrative geography, re-exported.

   The division/district data itself moved to @sakura/contracts when the admin
   order queue gained a division filter: an order stores the district it is
   bound for, not the division, so the API has to own the same mapping to run
   that query. This module stays as the web app's import point — every existing
   `@/lib/bd-geo` import keeps working — and owns the one piece that is genuinely
   web-only, the delivery-zone rule below.
   -------------------------------------------------------------------------- */

export { bdDivisions, districtsFor, divisionOfDistrict, divisionSlugs } from "@sakura/contracts";
export type { Division, DivisionSlug } from "@sakura/contracts";

/**
 * The two delivery zones, driven off the chosen division relative to
 * wherever the shop is currently shipping from — slugs match the
 * `delivery_regions` rows seeded in apps/api/src/db/seed/reference.ts.
 *
 * Not hardcoded to Dhaka: `originDivision` comes from GET /shipping/regions,
 * because the shop's shipment point can move (a different warehouse, a
 * publisher shipping direct) without a release. Same division as the origin
 * → "inside" zone; anything else → "outside". There is no third zone.
 */
export type DeliveryZone = "inside-dhaka" | "outside-dhaka";

export function deliveryZoneFor(divisionValue: string, originDivision: string): DeliveryZone {
  return divisionValue === originDivision ? "inside-dhaka" : "outside-dhaka";
}
