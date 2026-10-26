// County map geometry for any state, baked at generation time (never fetched
// at render time). Same recipe as src/nc-counties.json, which the Remotion
// render uses: U.S. Census county shapes from the us-atlas package (public
// domain), Mercator fitted to 1000 units wide, one decimal. For North
// Carolina this reproduces src/nc-counties.json exactly (test/geo.test.mjs).
import { createRequire } from "node:module";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);

/** USPS code → state FIPS (the first two digits of a county FIPS). */
export const STATE_FIPS = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11",
  FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21",
  LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30",
  NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
  OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49",
  VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};

export const WIDTH = 1000;
const PAD = 2;

let atlas = null;
function counties() {
  if (!atlas) {
    const us = require("us-atlas/counties-10m.json");
    atlas = feature(us, us.objects.counties).features;
  }
  return atlas;
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * { state, viewBox, width, height, counties: [{ id, name, d, x, y }] } where
 * x and y are the county centroid in percent of the map box (labels, dots).
 */
export function stateMap(state) {
  const st = String(state || "").toUpperCase();
  const prefix = STATE_FIPS[st];
  if (!prefix) throw new Error(`no map for state "${state}"`);
  const feats = counties().filter((f) => String(f.id).startsWith(prefix));
  if (!feats.length) throw new Error(`no counties for ${st}`);
  const fc = { type: "FeatureCollection", features: feats };
  const projection = geoMercator().fitWidth(WIDTH, fc);
  const path = geoPath(projection);
  const pathD = geoPath(projection).digits(1);
  const [[, y0], [, y1]] = path.bounds(fc);
  const height = Math.ceil(y1 - y0);
  const out = feats
    .map((f) => {
      const [cx, cy] = path.centroid(f);
      return {
        id: String(f.id),
        name: f.properties?.name || "",
        d: pathD(f) || "",
        // Percent of the padded viewBox: the box the map is drawn in.
        x: round1(((cx + PAD) / (WIDTH + 2 * PAD)) * 100),
        y: round1(((cy + PAD) / (height + 2 * PAD)) * 100),
      };
    })
    .filter((c) => c.d);
  return {
    state: st,
    viewBox: `${-PAD} ${-PAD} ${WIDTH + 2 * PAD} ${height + 2 * PAD}`,
    width: WIDTH,
    height,
    counties: out,
  };
}

/** County for a FIPS code ("37183") or a county name ("Wake", "Wake County"). */
export function countyFor(map, key) {
  if (!key) return undefined;
  const k = String(key).trim();
  const byId = map.counties.find((c) => c.id === k);
  if (byId) return byId;
  const name = k.toLowerCase().replace(/ (county|parish|borough)$/, "");
  return map.counties.find((c) => c.name.toLowerCase() === name);
}
