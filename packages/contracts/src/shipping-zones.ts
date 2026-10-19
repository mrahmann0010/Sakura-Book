/* --------------------------------------------------------------------------
   Delivery zones — where a parcel is going, and which of Pathao's three price
   tiers that puts it in.

   Pickup is always a store inside Dhaka City Corporation, which collapses
   Pathao's 12-row origin × destination matrix to a single column: ISD → ISD,
   ISD → Suburb, ISD → OSD. If pickup ever moves (Keraniganj, Savar…) these
   tiers stop mapping to the right rate column — see PICKUP_TIER in
   ./shipping-rates.

   Data rather than code, and shared rather than per-app: the checkout form,
   the cart quote and the order that is finally written all read this one list,
   so the zone a customer chooses and the zone they are charged for cannot be
   two lists that almost agree.

   ## Only as fine as the price

   A zone exists only where the price changes, because the price is all this
   list decides. The thana or upazila is typed by every customer as free text
   — the courier needs it, but no amount pivots on it. So:

   - Dhaka district is three zones: the city corporation (ISD), the Savar /
     Ashulia / Keraniganj / Dhamrai ring (SUBURB), and Dohar / Nawabganj (OSD).
   - Gazipur and Narayanganj are one SUBURB zone each — every part of both is
     priced the same.
   - Munshiganj is two: Gazaria (SUBURB) and the rest of the district (OSD).
   - Every other district is one OSD zone.

   A thana-by-thana list would pin down Pathao's exact zone name for the
   manifest, at the cost of a long pick for every Dhaka customer; the shop
   chose the short form. The customer declares which part of Dhaka they are
   in, so staff checking the typed thana against the choice is the safeguard.

   Source: Pathao's published rate card and hub directory, Oct 2026. Review
   quarterly — Pathao reassigns areas as it opens hubs, and nothing here will
   say when it has.
   -------------------------------------------------------------------------- */

export const shippingTiers = ["ISD", "SUBURB", "OSD"] as const;
export type ShippingTier = (typeof shippingTiers)[number];

export type ShippingZone = {
  /** Stable slug — persist this on the order, never the display name. */
  id: string;
  name: string;
  nameBn: string;
  tier: ShippingTier;
  /**
   * The district, spelt as in ./bd-geo. It is what an order stores as `city`,
   * which is how the admin queue's division filter and the Pathao manifest's
   * `RecipientCity` keep working off the same field they always read.
   */
  city: string;
};

type Row = [id: string, name: string, nameBn: string];

/* ------------------------------------------------------------------ */
/* Dhaka district — the one district with all three tiers in it         */
/* ------------------------------------------------------------------ */

const DHAKA: ShippingZone[] = [
  { id: "dhaka-city", name: "Dhaka city", nameBn: "ঢাকা শহর", tier: "ISD", city: "Dhaka" },
  {
    id: "savar-keraniganj",
    name: "Savar / Ashulia / Keraniganj / Dhamrai",
    nameBn: "সাভার / আশুলিয়া / কেরানীগঞ্জ / ধামরাই",
    tier: "SUBURB",
    city: "Dhaka",
  },
  {
    /* Dhaka district, but far enough out that Pathao files them outside the
       suburban hub group. Verify against a live quote before trusting it. */
    id: "dohar-nawabganj",
    name: "Dohar / Nawabganj",
    nameBn: "দোহার / নবাবগঞ্জ",
    tier: "OSD",
    city: "Dhaka",
  },
];

/* ------------------------------------------------------------------ */
/* The rest of the suburban ring                                        */
/* ------------------------------------------------------------------ */

const SUBURB: ShippingZone[] = [
  { id: "gazipur", name: "Gazipur", nameBn: "গাজীপুর", tier: "SUBURB", city: "Gazipur" },
  {
    id: "narayanganj",
    name: "Narayanganj",
    nameBn: "নারায়ণগঞ্জ",
    tier: "SUBURB",
    city: "Narayanganj",
  },
  // Only Gazaria is suburban; the rest of Munshiganj is OSD, below.
  { id: "gazaria", name: "Gazaria", nameBn: "গজারিয়া", tier: "SUBURB", city: "Munshiganj" },
];

/* ------------------------------------------------------------------ */
/* OSD — every other district, one zone each                            */
/* ------------------------------------------------------------------ */

/* [id, English (bd-geo spelling), Bangla]. Dhaka, Gazipur and Narayanganj are
   absent on purpose — they are covered above. Munshiganj is here as "the rest
   of the district", beside Gazaria. */
const OSD_DISTRICTS: Row[] = [
  ["bagerhat", "Bagerhat", "বাগেরহাট"],
  ["bandarban", "Bandarban", "বান্দরবান"],
  ["barguna", "Barguna", "বরগুনা"],
  ["barishal", "Barishal", "বরিশাল"],
  ["bhola", "Bhola", "ভোলা"],
  ["bogura", "Bogura", "বগুড়া"],
  ["brahmanbaria", "Brahmanbaria", "ব্রাহ্মণবাড়িয়া"],
  ["chandpur", "Chandpur", "চাঁদপুর"],
  ["chapainawabganj", "Chapainawabganj", "চাঁপাইনবাবগঞ্জ"],
  ["chattogram", "Chattogram", "চট্টগ্রাম"],
  ["chuadanga", "Chuadanga", "চুয়াডাঙ্গা"],
  ["coxsbazar", "Cox's Bazar", "কক্সবাজার"],
  ["cumilla", "Cumilla", "কুমিল্লা"],
  ["dinajpur", "Dinajpur", "দিনাজপুর"],
  ["faridpur", "Faridpur", "ফরিদপুর"],
  ["feni", "Feni", "ফেনী"],
  ["gaibandha", "Gaibandha", "গাইবান্ধা"],
  ["gopalganj", "Gopalganj", "গোপালগঞ্জ"],
  ["habiganj", "Habiganj", "হবিগঞ্জ"],
  ["jamalpur", "Jamalpur", "জামালপুর"],
  ["jashore", "Jashore", "যশোর"],
  ["jhalokathi", "Jhalokathi", "ঝালকাঠি"],
  ["jhenaidah", "Jhenaidah", "ঝিনাইদহ"],
  ["joypurhat", "Joypurhat", "জয়পুরহাট"],
  ["khagrachhari", "Khagrachhari", "খাগড়াছড়ি"],
  ["khulna", "Khulna", "খুলনা"],
  ["kishoreganj", "Kishoreganj", "কিশোরগঞ্জ"],
  ["kurigram", "Kurigram", "কুড়িগ্রাম"],
  ["kushtia", "Kushtia", "কুষ্টিয়া"],
  ["lakshmipur", "Lakshmipur", "লক্ষ্মীপুর"],
  ["lalmonirhat", "Lalmonirhat", "লালমনিরহাট"],
  ["madaripur", "Madaripur", "মাদারীপুর"],
  ["magura", "Magura", "মাগুরা"],
  ["manikganj", "Manikganj", "মানিকগঞ্জ"],
  ["meherpur", "Meherpur", "মেহেরপুর"],
  ["moulvibazar", "Moulvibazar", "মৌলভীবাজার"],
  ["munshiganj", "Munshiganj", "মুন্সিগঞ্জ"],
  ["mymensingh", "Mymensingh", "ময়মনসিংহ"],
  ["naogaon", "Naogaon", "নওগাঁ"],
  ["narail", "Narail", "নড়াইল"],
  ["narsingdi", "Narsingdi", "নরসিংদী"],
  ["natore", "Natore", "নাটোর"],
  ["netrokona", "Netrokona", "নেত্রকোণা"],
  ["nilphamari", "Nilphamari", "নীলফামারী"],
  ["noakhali", "Noakhali", "নোয়াখালী"],
  ["pabna", "Pabna", "পাবনা"],
  ["panchagarh", "Panchagarh", "পঞ্চগড়"],
  ["patuakhali", "Patuakhali", "পটুয়াখালী"],
  ["pirojpur", "Pirojpur", "পিরোজপুর"],
  ["rajbari", "Rajbari", "রাজবাড়ী"],
  ["rajshahi", "Rajshahi", "রাজশাহী"],
  ["rangamati", "Rangamati", "রাঙ্গামাটি"],
  ["rangpur", "Rangpur", "রংপুর"],
  ["satkhira", "Satkhira", "সাতক্ষীরা"],
  ["shariatpur", "Shariatpur", "শরীয়তপুর"],
  ["sherpur", "Sherpur", "শেরপুর"],
  ["sirajganj", "Sirajganj", "সিরাজগঞ্জ"],
  ["sunamganj", "Sunamganj", "সুনামগঞ্জ"],
  ["sylhet", "Sylhet", "সিলেট"],
  ["tangail", "Tangail", "টাঙ্গাইল"],
  ["thakurgaon", "Thakurgaon", "ঠাকুরগাঁও"],
];

const OSD: ShippingZone[] = OSD_DISTRICTS.map(([id, name, nameBn]) => ({
  id,
  name,
  nameBn,
  tier: "OSD" as const,
  city: name,
}));

/* ------------------------------------------------------------------ */

export const SHIPPING_ZONES: readonly ShippingZone[] = [...DHAKA, ...SUBURB, ...OSD];

export const ZONES_BY_ID: ReadonlyMap<string, ShippingZone> = new Map(
  SHIPPING_ZONES.map((zone) => [zone.id, zone]),
);

export function zoneById(id: string | undefined | null): ShippingZone | undefined {
  return id ? ZONES_BY_ID.get(id) : undefined;
}

export function tierOfZone(id: string | undefined | null): ShippingTier | undefined {
  return zoneById(id)?.tier;
}

/**
 * The zones inside one district, by its bd-geo spelling.
 *
 * One for almost every district; three for Dhaka and two for Munshiganj,
 * the only districts whose price changes inside them. That count is what the
 * address form branches on.
 */
export function zonesInDistrict(district: string): ShippingZone[] {
  return SHIPPING_ZONES.filter((zone) => zone.city === district);
}
/**
 * The `delivery_regions` row each tier is priced from.
 *
 * The two original slugs are kept rather than renamed: every order placed
 * before this shipped snapshots `inside-dhaka` or `outside-dhaka` onto its
 * address, and receipts translate by slug. SUBURB is the one new row.
 */
export const TIER_REGION_SLUG: Readonly<Record<ShippingTier, string>> = {
  ISD: "inside-dhaka",
  SUBURB: "dhaka-suburb",
  OSD: "outside-dhaka",
};

export function tierOfRegion(slug: string | undefined | null): ShippingTier | undefined {
  return shippingTiers.find((tier) => TIER_REGION_SLUG[tier] === slug);
}
