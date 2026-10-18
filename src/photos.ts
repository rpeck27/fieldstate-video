// A photo renders only for the place it depicts, and only with this credit.
// Cumberland County Courthouse, Fayetteville.
// Photo: Gerry Dincher. CC BY-SA 2.0.
// https://commons.wikimedia.org/wiki/File:Cumberland_County,_North_Carolina_courthouse.jpg

export type PhotoCredit = {
  file: string;
  place: string;
  credit: string;
};

export const PHOTOS: PhotoCredit[] = [
  {
    file: "photos/cumberland.jpg",
    place: "Cumberland County, NC",
    credit: "Cumberland County Courthouse · Photo: Gerry Dincher, CC BY-SA 2.0, via Wikimedia Commons",
  },
];

export function photoFor(place?: string | null, county?: string | null): PhotoCredit | null {
  const keys = new Set<string>();
  if (place) keys.add(place.trim().toLowerCase());
  if (county) keys.add(`${county.trim()} County, NC`.toLowerCase());
  return PHOTOS.find((p) => keys.has(p.place.toLowerCase())) ?? null;
}
