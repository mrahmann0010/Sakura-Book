/* --------------------------------------------------------------------------
   Delivery zones — where a parcel is going, and which of Pathao's three price
   tiers that puts it in.

   Pickup is always a store inside Dhaka City Corporation, which collapses
   Pathao's 12-row origin × destination matrix to a single column: ISD → ISD,
   ISD → Suburb, ISD → OSD. If pickup ever moves (Keraniganj, Savar…) these
   tiers stop mapping to the right rate column — see PICKUP_TIER in
   ./shipping-rates.

   Data rather than code, and shared rather than per-app: the checkout picker,
   the cart quote and the order that is finally written all read this one list,
   so the zone a customer chooses and the zone they are charged for cannot be
   two lists that almost agree.

   Granularity follows what decides the price. Inside Dhaka and the suburban
   ring the tier changes from one thana to the next, so those are listed zone
   by zone; everywhere else is one rate, so a district is enough and the
   upazila stays a free-text field on the address form.

   Source: Pathao's published rate card and hub directory, Oct 2026. Review
   quarterly — Pathao reassigns zones as it opens hubs, and nothing here will
   say when it has. The first month's invoices reconciled against the orders'
   tiers is what catches a zone filed in the wrong place.
   -------------------------------------------------------------------------- */

export const shippingTiers = ["ISD", "SUBURB", "OSD"] as const;
export type ShippingTier = (typeof shippingTiers)[number];

export type ShippingZone = {
  /** Stable slug — persist this on the order, never the display name. */
  id: string;
  name: string;
  nameBn: string;
  tier: ShippingTier;
  /** The dropdown's optgroup. */
  group: ShippingZoneGroup;
  /**
   * The district, spelt as in ./bd-geo. It is what an order stores as `city`,
   * which is how the admin queue's division filter and the Pathao manifest's
   * `RecipientCity` keep working off the same field they always read.
   */
  city: string;
};

export const shippingZoneGroups = [
  "dhaka-north",
  "dhaka-south",
  "savar-keraniganj",
  "gazipur",
  "narayanganj",
  "munshiganj",
  "outside-dhaka",
] as const;
export type ShippingZoneGroup = (typeof shippingZoneGroups)[number];

type Row = [id: string, name: string, nameBn: string];

function zones(
  tier: ShippingTier,
  group: ShippingZoneGroup,
  city: string,
  rows: Row[],
): ShippingZone[] {
  return rows.map(([id, name, nameBn]) => ({ id, name, nameBn, tier, group, city }));
}

/* ------------------------------------------------------------------ */
/* ISD — inside Dhaka City Corporation                                  */
/* ------------------------------------------------------------------ */

const ISD: ShippingZone[] = [
  ...zones("ISD", "dhaka-north", "Dhaka", [
    ["uttara", "Uttara", "উত্তরা"],
    ["dakshinkhan", "Dakshinkhan", "দক্ষিণখান"],
    ["uttarkhan", "Uttarkhan", "উত্তরখান"],
    ["turag", "Turag", "তুরাগ"],
    ["khilkhet", "Khilkhet", "খিলক্ষেত"],
    ["biman-bandar", "Biman Bandar", "বিমান বন্দর"],
    ["badda", "Badda", "বাড্ডা"],
    ["vatara", "Vatara", "ভাটারা"],
    ["bashundhara-ra", "Bashundhara R/A", "বসুন্ধরা আ/এ"],
    ["satarkul", "Satarkul", "সাতারকুল"],
    ["beraid", "Beraid", "বেরাইদ"],
    ["gulshan", "Gulshan", "গুলশান"],
    ["banani", "Banani", "বনানী"],
    ["mohakhali", "Mohakhali", "মহাখালী"],
    ["niketan", "Niketan", "নিকেতন"],
    ["cantonment", "Dhaka Cantonment", "ঢাকা সেনানিবাস"],
    ["kafrul", "Kafrul", "কাফরুল"],
    ["ibrahimpur", "Ibrahimpur", "ইব্রাহিমপুর"],
    ["mirpur", "Mirpur", "মিরপুর"],
    ["pallabi", "Pallabi", "পল্লবী"],
    ["rupnagar", "Rupnagar", "রূপনগর"],
    ["shah-ali", "Shah Ali", "শাহ আলী"],
    ["darus-salam", "Darus Salam", "দারুস সালাম"],
    ["mirpur-1", "Mirpur-1 / Gabtoli", "মিরপুর-১ / গাবতলী"],
    ["shewrapara", "Shewrapara / Kazipara", "শেওড়াপাড়া / কাজীপাড়া"],
    ["adabor", "Adabor", "আদাবর"],
    ["mohammadpur", "Mohammadpur", "মোহাম্মদপুর"],
    ["sher-e-bangla", "Sher-e-Bangla Nagar", "শেরেবাংলা নগর"],
    ["agargaon", "Agargaon", "আগারগাঁও"],
    ["tejgaon", "Tejgaon", "তেজগাঁও"],
    ["farmgate", "Farmgate", "ফার্মগেট"],
    ["hatirjheel", "Hatirjheel", "হাতিরঝিল"],
    ["ramna", "Ramna", "রমনা"],
    ["shahbagh", "Shahbagh", "শাহবাগ"],
    ["dhanmondi", "Dhanmondi", "ধানমন্ডি"],
    ["kalabagan", "Kalabagan", "কলাবাগান"],
    ["new-market", "New Market", "নিউ মার্কেট"],
    ["elephant-road", "Elephant Road", "এলিফ্যান্ট রোড"],
  ]),

  ...zones("ISD", "dhaka-south", "Dhaka", [
    ["lalbagh", "Lalbagh", "লালবাগ"],
    ["chawkbazar", "Chawkbazar", "চকবাজার"],
    ["bangshal", "Bangshal", "বংশাল"],
    ["kotwali", "Kotwali", "কোতোয়ালী"],
    ["banglabazar", "Banglabazar", "বাংলাবাজার"],
    ["sutrapur", "Sutrapur", "সূত্রাপুর"],
    ["gendaria", "Gendaria", "গেন্ডারিয়া"],
    ["wari", "Wari", "ওয়ারী"],
    ["hazaribagh", "Hazaribagh", "হাজারীবাগ"],
    ["kamrangirchar", "Kamrangirchar", "কামরাঙ্গীরচর"],
    ["motijheel", "Motijheel", "মতিঝিল"],
    ["paltan", "Paltan", "পল্টন"],
    ["shahjahanpur", "Shahjahanpur", "শাহজাহানপুর"],
    ["khilgaon", "Khilgaon", "খিলগাঁও"],
    ["sabujbagh", "Sabujbagh / Bashabo", "সবুজবাগ / বাসাবো"],
    ["mugda", "Mugda", "মুগদা"],
    ["malibagh", "Malibagh", "মালিবাগ"],
    ["rampura", "Rampura", "রামপুরা"],
    ["jatrabari", "Jatrabari", "যাত্রাবাড়ী"],
    ["kadamtali", "Kadamtali", "কদমতলী"],
    ["shyampur", "Shyampur", "শ্যামপুর"],
    ["dania", "Dania", "দনিয়া"],
    ["rayerbag", "Rayerbag", "রায়েরবাগ"],

    /* Absorbed into DSCC in the 2016–17 expansion. These feel like the city's
       edge but are ISD — Pathao runs its Demra hub under Inside Dhaka. */
    ["demra", "Demra", "ডেমরা"],
    ["sarulia", "Sarulia", "সারুলিয়া"],
    ["matuail", "Matuail", "মাতুয়াইল"],
    ["konapara", "Konapara", "কোনাপাড়া"],
    ["dakshingaon", "Dakshingaon", "দক্ষিণগাঁও"],
    ["nasirabad-dhaka", "Nasirabad (Dhaka)", "নাসিরাবাদ"],
    ["manda", "Manda", "মান্ডা"],
  ]),
];

/* ------------------------------------------------------------------ */
/* SUBURB — the ring around Dhaka city                                  */
/* ------------------------------------------------------------------ */

const SUBURB: ShippingZone[] = [
  // Dhaka district, outside the city corporation.
  ...zones("SUBURB", "savar-keraniganj", "Dhaka", [
    ["savar", "Savar", "সাভার"],
    ["ashulia", "Ashulia", "আশুলিয়া"],
    ["baipail", "Baipail", "বাইপাইল"],
    ["hemayetpur", "Hemayetpur", "হেমায়েতপুর"],
    ["amin-bazar", "Amin Bazar", "আমিন বাজার"],
    ["dhamrai", "Dhamrai", "ধামরাই"],
    ["keraniganj", "Keraniganj", "কেরানীগঞ্জ"],
    ["zinzira", "Zinzira", "জিনজিরা"],
    ["atibazar", "Atibazar", "আটিবাজার"],
    ["chunkutia", "Chunkutia", "চুনকুটিয়া"],
    ["hasnabad", "Hasnabad", "হাসনাবাদ"],
    ["kalatia", "Kalatia", "কালাতিয়া"],
  ]),

  ...zones("SUBURB", "gazipur", "Gazipur", [
    ["tongi", "Tongi", "টঙ্গী"],
    ["board-bazar", "Board Bazar", "বোর্ড বাজার"],
    ["joydebpur", "Joydebpur", "জয়দেবপুর"],
    ["gazipur-chowrasta", "Gazipur Chowrasta", "গাজীপুর চৌরাস্তা"],
    ["kashimpur", "Kashimpur", "কাশিমপুর"],
    ["kaliakair", "Kaliakair", "কালিয়াকৈর"],
    ["kaliganj-gazipur", "Kaliganj (Gazipur)", "কালীগঞ্জ"],
    ["mawna", "Mawna / Sreepur", "মাওনা / শ্রীপুর"],
    ["kapasia", "Kapasia", "কাপাসিয়া"],
  ]),

  ...zones("SUBURB", "narayanganj", "Narayanganj", [
    ["narayanganj-sadar", "Narayanganj Sadar", "নারায়ণগঞ্জ সদর"],
    ["fatullah", "Fatullah", "ফতুল্লা"],
    ["siddhirganj", "Siddhirganj", "সিদ্ধিরগঞ্জ"],
    ["bandar", "Bandar", "বন্দর"],
    ["rupganj", "Rupganj", "রূপগঞ্জ"],
    ["bhulta-gawsia", "Bhulta-Gawsia", "ভুলতা-গাউছিয়া"],
    ["araihazar", "Araihazar", "আড়াইহাজার"],
    ["sonargaon", "Sonargaon", "সোনারগাঁও"],
  ]),

  // Only Gazaria is suburban; the rest of Munshiganj is OSD.
  ...zones("SUBURB", "munshiganj", "Munshiganj", [["gazaria", "Gazaria", "গজারিয়া"]]),
];

/* ------------------------------------------------------------------ */
/* OSD — rest of the country; district granularity is enough            */
/* ------------------------------------------------------------------ */

/* [id, English (bd-geo spelling), Bangla]. Dhaka, Gazipur and Narayanganj are
   absent on purpose — they are covered zone by zone above. */
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

const OSD: ShippingZone[] = [
  ...OSD_DISTRICTS.map(([id, name, nameBn]) => ({
    id,
    name,
    nameBn,
    tier: "OSD" as const,
    group: "outside-dhaka" as const,
    city: name,
  })),

  /* Dhaka district, but far enough out that Pathao files them outside the
     suburban hub group. Verify against a live quote before trusting SUBURB. */
  ...zones("OSD", "outside-dhaka", "Dhaka", [
    ["dohar", "Dohar", "দোহার"],
    ["nawabganj", "Nawabganj (Dhaka)", "নবাবগঞ্জ"],
  ]),
];

/* ------------------------------------------------------------------ */

export const SHIPPING_ZONES: readonly ShippingZone[] = [...ISD, ...SUBURB, ...OSD];

export const ZONES_BY_ID: ReadonlyMap<string, ShippingZone> = new Map(
  SHIPPING_ZONES.map((zone) => [zone.id, zone]),
);

export function zoneById(id: string | undefined | null): ShippingZone | undefined {
  return id ? ZONES_BY_ID.get(id) : undefined;
}

export function tierOfZone(id: string | undefined | null): ShippingTier | undefined {
  return zoneById(id)?.tier;
}

/** Grouped for a picker with optgroups, in the order the groups are declared. */
export function groupedZones(): { group: ShippingZoneGroup; zones: ShippingZone[] }[] {
  return shippingZoneGroups.map((group) => ({
    group,
    zones: SHIPPING_ZONES.filter((zone) => zone.group === group),
  }));
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
