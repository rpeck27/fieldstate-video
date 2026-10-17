// The site's palette and type (fieldstate-site: Newsreader for the record,
// Geist for the product, navy ink, light theme).
import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadNewsreader } from "@remotion/google-fonts/Newsreader";

export const geist = loadGeist("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;
export const newsreader = loadNewsreader("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;

export const C = {
  bg: "#ffffff",
  panel: "#f6f9fc",
  ink: "#0a2540",
  body: "#425466",
  muted: "#697386",
  line: "#e6ebf1",
  live: "#f0a62b",
  liveDeep: "#b54708",
};
