/* --------------------------------------------------------------------------
   Bangladesh administrative geography, re-exported.

   The division/district data itself moved to @sakura/contracts when the admin
   order queue gained a division filter: an order stores the district it is
   bound for, not the division, so the API has to own the same mapping to run
   that query. This module stays as the web app's import point — every existing
   `@/lib/bd-geo` import keeps working. Delivery zones are not geography in this
   sense — they are Pathao's pricing tiers — and live in @sakura/contracts'
   shipping-zones.
   -------------------------------------------------------------------------- */

export { bdDivisions, districtsFor, divisionOfDistrict, divisionSlugs } from "@sakura/contracts";
export type { Division, DivisionSlug } from "@sakura/contracts";
