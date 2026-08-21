/* --------------------------------------------------------------------------
   Bangladesh administrative geography — 8 divisions, 64 districts.

   Client-side only, for the checkout address form's Division → District
   cascade. Upazila/Thana and Area/Village stay free text: there is no
   authoritative ~495-entry upazila list wired in here, so guessing one would
   risk shipping wrong names on a form real customers fill in.
   -------------------------------------------------------------------------- */

export type Division = {
  value: string;
  label: string;
  districts: readonly string[];
};

export const bdDivisions: readonly Division[] = [
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
] as const;

export function districtsFor(divisionValue: string): readonly string[] {
  return bdDivisions.find((division) => division.value === divisionValue)?.districts ?? [];
}

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
