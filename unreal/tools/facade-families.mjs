// Which City Sample facade kits each of the web renderer's facade families can wear
// -> unreal/BroadwayWall/Data/facade-families.json, read by ACityBuilder::KitFor.
//
//   node unreal/tools/kit-families.mjs [city.json]
//
// The web map draws ~118 families (map/real/facades.ts, and the pattern book's
// cousins). Unreal has 18 kits, so each family lists the kits nearest it in
// material and era, and a building picks among them by its own hash. Variety
// then comes three ways, as on the web: the family (by year, use, height,
// district and neighbourhood), the kit among that family's fits, and the
// family's per-building wall tint (Color Tint M1 on the kit's wall material).
// A family not listed falls back to the original it was drawn from (LIKE).
//
// Kit characters, from their materials (unreal/kits/kit-*.json):
//   NYA  brick walk-up, red/beige/brown/yellow brick, painted stone trim
//   NYH  brownstone row: red brick, brown limestone, charcoal stoops
//   NYG  Art Deco limestone tower
//   CHA  limestone tower, brass and copper: the Chicago-school office
//   CHB  beige limestone with gold, copper and cedar: Beaux-Arts / revival
//   CHC  grey limestone with painted metal bays: terra cotta, Sullivan
//   CHD  beige limestone and copper, plain: the stripped classical
//   CHE  brown granite base, limestone: Romanesque, armory
//   CHF  white/green glazed brick, black granite: loft, daylight factory
//   CHG  brown brick, brass, mirror: cast iron and the brick pier
//   CHH  brown granite and mirror: moderne, mid-century
//   CHI  red/brown brick with copper: deco brick, collegiate, school
//   CHJ  grey granite, painted metal: brutalist, post-war precast
//   SFA  red brick, khaki painted stone, granite: new brick and stucco
//   SFB  grey limestone, gold, copper, cedar: postmodern, new stone
//   SFC  brushed metal panels: ribbon, grid, metal panel
//   SFE  black granite and limestone strips: modern, fins
//   SFJ  curtain wall, gold and black mullions: the glass tower
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "BroadwayWall", "Data");
const { LIKE } = await import(pathToFileURL(join(HERE, "families.mjs")).href);

const KITS = {
  // the originals
  brick: ["NYA", "CHI", "NYH", "SFA"], buff: ["NYA", "CHI", "CHF"], brownstone: ["NYH", "NYA"],
  whitebrick: ["CHF", "NYA"], georgian: ["NYA", "CHB", "NYH"], gothic: ["CHC", "CHE"],
  romanesque: ["CHE", "NYH"], castiron: ["CHG", "CHC"], stone: ["CHA", "CHD", "CHB"],
  terracotta: ["CHC", "CHA"], deco: ["NYG", "CHD"], decobrick: ["CHI", "NYG"],
  moderne: ["CHH", "CHF"], stucco: ["SFA", "CHF"], tudor: ["NYH", "CHE"], clapboard: ["NYA", "SFA"],
  industrial: ["CHF", "CHG"], daylight: ["CHF", "CHJ"], midcentury: ["CHH", "SFE"],
  modern: ["SFE", "CHH", "SFC", "CHJ"], precast: ["CHJ", "SFB", "SFC", "CHF"], brutalist: ["CHJ"],
  pomo: ["SFB", "SFA"], ribbon: ["SFC", "SFE"], grid: ["SFC", "CHJ"], fins: ["SFE", "SFJ"],
  newstone: ["SFB", "CHD"], stackbrick: ["SFA", "CHI"], fibercement: ["SFA", "SFB"],
  metalpanel: ["SFC", "SFB"], rainscreen: ["SFB", "SFC"], timber: ["SFB", "SFA"],
  glass: ["SFJ", "SFC"], blueglass: ["SFJ"], greenglass: ["SFJ", "SFE"], silverglass: ["SFJ", "SFC"],
  blackglass: ["SFJ", "SFE"], bronze: ["SFJ", "CHH"], diagrid: ["SFJ"], pixel: ["SFJ", "SFB"],
  shop: ["CHG", "NYA"], lobby: ["SFE"], plain: ["CHJ", "NYA"], rustic: ["CHE"], arcade: ["CHB", "CHG"],
  // the cousins that read differently from their original
  greystone: ["CHE", "CHD"], formstone: ["NYH"], tenement: ["NYA"], phillyrow: ["NYH", "NYA"],
  twoflat: ["NYA", "CHI"], tripledecker: ["NYA"], prairie: ["CHI", "CHH"], craftsman: ["CHI", "SFA"],
  mission: ["SFA"], pueblo: ["SFA"], mediterranean: ["SFA", "CHD"], spanishcolonial: ["SFA"],
  beachdeco: ["NYG", "CHH"], zigzag: ["NYG", "CHI"], pwa: ["CHD", "NYG"], stripped: ["CHD", "CHJ"],
  beauxarts: ["CHB", "CHA"], chateau: ["CHB"], secondempire: ["CHB", "CHE"], palazzo: ["CHB", "CHA"],
  greekrevival: ["CHD", "CHB"], egyptian: ["CHD"], edwardian: ["CHA", "CHE"], bank: ["CHB", "CHD"],
  venetian: ["CHC"], sullivanesque: ["CHC"], neogrec: ["NYH"], collegiate: ["CHI", "CHE"],
  armory: ["CHE"], schoolbrick: ["CHI"], neogeorgian: ["CHB", "NYA"], federal: ["NYA", "NYH"],
  powerhouse: ["CHF", "CHG"], brewery: ["CHG", "CHF"], textilemill: ["CHG", "CHF"], terminal: ["CHB", "CHF"],
  pumphouse: ["CHG"], corrugated: ["SFC"], tiltup: ["CHJ", "SFC"], flexspace: ["SFC", "SFE"],
  datacentre: ["SFC", "CHJ"], selfstorage: ["SFC"], projectbrick: ["NYA", "CHI"], brickpier: ["CHG", "SFA"],
  newformalism: ["CHH", "CHD"], screenblock: ["CHJ", "SFE"], brisesoleil: ["SFE"], eggcrate: ["CHJ", "SFC"],
  hightech: ["SFC", "SFJ"], doubleskin: ["SFJ"], goldglass: ["SFJ"], roseglass: ["SFJ"],
  goldanodized: ["SFB", "SFJ"], stripglass: ["SFC", "SFJ"], baguetteglass: ["SFE", "SFB"],
  channelglass: ["SFC"], copperclad: ["SFB"], corten: ["SFC", "SFB"], ceramictile: ["SFB", "CHC"],
  greenwall: ["SFB"], charredwood: ["SFB"], fluted: ["SFB", "CHD"], gfrc: ["SFB", "SFE"], glassblock: ["CHF"],
  sunshade: ["SFE"], sawtooth: ["SFJ"],
};

const doc = { format: "bw-kit-families/1", kits: KITS, like: LIKE };
writeFileSync(join(DATA, "facade-families.json"), JSON.stringify(doc, null, 1));

// the share of facade area each kit takes in a city (perimeter x height), by
// the same pick the game makes: the family's list, by the volume's hash
const city = process.argv[2] ?? join(DATA, "city-1-metro.json");
const kitOf = (fam, bbl) => {
  const list = KITS[fam] ?? KITS[LIKE[fam]] ?? ["NYA"];
  let h = 2166136261;
  for (let i = 0; i < bbl.length; i++) { h ^= bbl.charCodeAt(i); h = Math.imul(h, 16777619); }
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return list[h % list.length];
};
const d = JSON.parse(readFileSync(city, "utf8"));
const share = {}; let tot = 0;
for (const v of d.volumes) {
  if (!v.fam) continue;
  let per = 0;
  for (let i = 0; i < v.ring.length; i += 2) { const j = (i + 2) % v.ring.length; per += Math.hypot(v.ring[j] - v.ring[i], v.ring[j + 1] - v.ring[i + 1]); }
  const a = per * (v.z1 - v.z0);
  const k = kitOf(v.fam, v.bbl || `${v.ring[0]},${v.ring[1]}`);
  share[k] = (share[k] ?? 0) + a; tot += a;
}
const missing = Object.keys(LIKE).concat(Object.keys(KITS)).filter((f) => !KITS[f] && !KITS[LIKE[f]]);
console.log(`facade-families.json: ${Object.keys(KITS).length} families mapped${missing.length ? `, unmapped: ${missing.join(" ")}` : ""}`);
console.log(Object.entries(share).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((100 * v) / tot).toFixed(1)}%`).join("  "));
