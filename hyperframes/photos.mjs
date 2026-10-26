// A photo renders only for the place it depicts, and only with this credit.
// Same list as src/photos.ts (the Remotion render); test/hyperframes.test.mjs
// fails if the two drift. Files live under public/.
export const PHOTOS = [
  {
    file: "photos/cumberland.jpg",
    place: "Cumberland County, NC",
    credit: "Cumberland County Courthouse · Photo: Gerry Dincher, CC BY-SA 2.0, via Wikimedia Commons",
  },
];

/** The licensed photo for a place ("Fayetteville, NC") or county, if any. */
export function photoFor(place, county, state = "NC") {
  const keys = new Set();
  if (place) keys.add(String(place).trim().toLowerCase());
  if (county) keys.add(`${String(county).trim()} County, ${String(state || "").toUpperCase()}`.toLowerCase());
  return PHOTOS.find((p) => keys.has(p.place.toLowerCase())) ?? null;
}
