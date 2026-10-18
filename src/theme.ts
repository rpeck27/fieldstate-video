// The Fieldstate kit, as in the Oct 14 pilot: Newsreader for the record,
// Geist for the product, a navy stage with a slow wash, white cards so the
// record reads, gold for what is live.
import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadNewsreader } from "@remotion/google-fonts/Newsreader";

export const geist = loadGeist("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
export const newsreader = loadNewsreader("normal", { weights: ["500", "600"], subsets: ["latin"] }).fontFamily;
export const newsreaderItalic = loadNewsreader("italic", { weights: ["500"], subsets: ["latin"] }).fontFamily;

export const C = {
  navy: "#0a2540",
  navy2: "#0f2e4f",
  stage: "#0a2540",
  stageMid: "#12304f",
  card: "#ffffff",
  ink: "#0a2540",
  body: "#425466",
  muted: "#697386",
  line: "#e6ebf1",
  live: "#f0a62b",
  doc: "#0e8560",
  docSoft: "#effbf6",
  deny: "#b3352c",
  denySoft: "#fff3f2",
  reported: "#7c5cff",
  reportedSoft: "#f3f0ff",
  white: "#ffffff",
  dim: "rgba(255,255,255,.72)",
};
