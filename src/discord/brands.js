// The two paid product lines, plus the community-only brand. These map 1:1
// onto the `Brand` single-select in Airtable's Clients table, which already
// held exactly these three values before the restructure - so nothing here
// needed renaming or backfilling.
//
// Brand and tier are deliberately separate axes: brand decides which course
// content you see, tier decides how much of the team you get. A client is
// one of each, and an upsell moves the tier without touching the brand.
export const BRANDS = [
  {
    key: 'coaches',
    name: 'Called Coaches',
    airtableValue: 'Called Coaches',
    roleName: 'Called Coaches',
    categoryName: 'CALLED COACHES',
  },
  {
    key: 'creators',
    name: 'Called Creators',
    airtableValue: 'Called Creators',
    roleName: 'Called Creators',
    categoryName: 'CALLED CREATORS',
  },
  {
    key: 'the-called',
    name: 'The Called',
    airtableValue: 'The Called',
    roleName: 'The Called',
    // Bible-study members get no brand category - the shared THE CALLED
    // section is everything they have access to.
    categoryName: null,
  },
];

export const BRAND_ROLE_NAMES = BRANDS.map((brand) => brand.roleName);

export function getBrandByKey(key) {
  return BRANDS.find((brand) => brand.key === key) ?? null;
}

export function getBrandByAirtableValue(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return BRANDS.find((brand) => brand.airtableValue.toLowerCase() === normalized) ?? null;
}
