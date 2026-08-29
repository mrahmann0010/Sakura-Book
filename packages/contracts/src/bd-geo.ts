/* --------------------------------------------------------------------------
   Bangladesh administrative geography — 8 divisions, 64 districts.

   This started as client-side-only data for the checkout address form's
   Division → District cascade, and it still drives that. It lives here now
   because the admin order queue filters by division, and the API is the side
   that has to run that filter: an order stores the *district* it is going to
   (`shippingAddress.city`), never the division, so "orders bound for Sylhet"
   is a query over the districts a division contains. Two copies of that
   mapping would mean an order that the panel offers a filter for and the
   database never returns.

   Upazila/Thana and Area/Village stay free text: there is no authoritative
   ~495-entry upazila list wired in here, so guessing one would risk shipping
   wrong names on a form real customers fill in.
   -------------------------------------------------------------------------- */

export type Division = {
  value: string;
  label: string;
  districts: readonly string[];
};

export const bdDivisions = [
  {
    value: "dhaka",
    label: "Dhaka",
    districts: [
      "Dhaka",
      "Faridpur",
      "Gazipur",
      "Gopalganj",
      "Kishoreganj",
      "Madaripur",
      "Manikganj",
      "Munshiganj",
      "Narayanganj",
      "Narsingdi",
      "Rajbari",
      "Shariatpur",
      "Tangail",
    ],
  },
  {
    value: "chattogram",
    label: "Chattogram",
    districts: [
      "Bandarban",
      "Brahmanbaria",
      "Chandpur",
      "Chattogram",
      "Cumilla",
      "Cox's Bazar",
      "Feni",
      "Khagrachhari",
      "Lakshmipur",
      "Noakhali",
      "Rangamati",
    ],
  },
  {
    value: "rajshahi",
    label: "Rajshahi",
    districts: [
      "Bogura",
      "Joypurhat",
      "Naogaon",
      "Natore",
      "Chapainawabganj",
      "Pabna",
      "Rajshahi",
      "Sirajganj",
    ],
  },
  {
    value: "khulna",
    label: "Khulna",
    districts: [
      "Bagerhat",
      "Chuadanga",
      "Jashore",
      "Jhenaidah",
      "Khulna",
      "Kushtia",
      "Magura",
      "Meherpur",
      "Narail",
      "Satkhira",
    ],
  },
  {
    value: "barishal",
    label: "Barishal",
    districts: ["Barguna", "Barishal", "Bhola", "Jhalokathi", "Patuakhali", "Pirojpur"],
  },
  {
    value: "sylhet",
    label: "Sylhet",
    districts: ["Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"],
  },
  {
    value: "rangpur",
    label: "Rangpur",
    districts: [
      "Dinajpur",
      "Gaibandha",
      "Kurigram",
      "Lalmonirhat",
      "Nilphamari",
      "Panchagarh",
      "Rangpur",
      "Thakurgaon",
    ],
  },
  {
    value: "mymensingh",
    label: "Mymensingh",
    districts: ["Jamalpur", "Mymensingh", "Netrokona", "Sherpur"],
  },
] as const satisfies readonly Division[];

/**
 * The eight slugs, as a tuple, so `z.enum(divisionSlugs)` validates a division
 * filter against the same list the pickers are built from.
 */
export const divisionSlugs = bdDivisions.map((division) => division.value) as unknown as [
  string,
  ...string[],
];

export type DivisionSlug = (typeof bdDivisions)[number]["value"];

export function districtsFor(divisionValue: string): readonly string[] {
  return bdDivisions.find((division) => division.value === divisionValue)?.districts ?? [];
}

/**
 * Which division a stored district belongs to, or null for one that isn't in
 * the list — an address typed before the cascading picker existed, or a
 * district renamed since. Null rather than a guess: a wrong division on a
 * fulfilment list routes a parcel to the wrong depot.
 */
export function divisionOfDistrict(district: string): Division | null {
  const needle = district.trim().toLowerCase();

  return (
    bdDivisions.find((division) =>
      division.districts.some((name) => name.toLowerCase() === needle),
    ) ?? null
  );
}
