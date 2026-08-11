// THE OTHER HALF OF THE CITY, WHICH NOTHING IN THE REPO COULD SEE.
//
// `pnpm styles` sweeps the generator and reports what the town it starts with
// is made of. It cannot see `setPlayerBuildings` — everything the player and
// the rivals put up, which after twenty years is most of downtown — because
// that path takes finished buildings rather than a seed, and there is no city
// to sweep. It was choosing from six facade families out of eighty-two for an
// unknown number of commits and no check in the repo was shaped to notice.
//
// This paints a controlled slate through that path — a spread of classes,
// floors and years over a block of real parcels — and counts what actually
// reached the mesh. Facade families, roof surfaces, and the crown materials,
// which is how you tell a building that ends in something from one that stops.
//
//   node tools/shoot.mjs http://127.0.0.1:5173/ /tmp/slate.png --wait 12000 \
//     --profile /tmp/bw-prof --verbose --settle 20000 \
//     --eval "$(cat tools/probe/playerslate.js)"
//
// It holds the camera and repaints on an interval, because MapView's own paint
// effect will otherwise overwrite the slate with the real (empty) portfolio.
(async () => { try {
  const S = () => window.__store.getState();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!S().parcels) {
    const b = [...document.querySelectorAll("button")];
    (b.find((x) => /Continue|Resume|Pick it back up/i.test(x.textContent || "")) ||
     b.find((x) => /Break ground/.test(x.textContent || ""))).click();
  }
  for (let i = 0; i < 90 && !S().parcels; i++) await sleep(500);
  await sleep(9000);
  const m = window.__map, L = window.__three;
  let feats = [];
  for (let t = 0; t < 20 && !feats.length; t++) {
    feats = m.queryRenderedFeatures({ layers: ["bw-parcel-fill"] });
    if (!feats.length) await sleep(500);
  }
  const at = new Map();
  for (const f of feats) {
    const b = f.properties?.bbl;
    if (!b || at.has(b)) continue;
    const g = f.geometry;
    const ring = g?.type === "Polygon" ? g.coordinates[0] : g?.coordinates?.[0]?.[0];
    if (!ring?.length) continue;
    let x = 0, y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    at.set(b, [x / ring.length, y / ring.length]);
  }
  // A contiguous block, so the camera can frame all of it at once.
  const bbls = [...at.keys()].sort().slice(0, 120);
  const CLS = ["office", "multifamily", "retail", "office", "multifamily", "industrial", "office", "retail"];
  const items = bbls.map((bbl, i) => {
    const cls = CLS[i % CLS.length];
    // low-rise, mid-rise and the occasional tower — the mid-rise band is the
    // one the massing ladder owns and the one that was byte-identical.
    const floors = cls === "retail" ? 1 + (i % 3)
      : cls === "industrial" ? 1 + (i % 2)
      : i % 9 === 0 ? 24 + (i % 11) : i % 3 === 0 ? 9 + (i % 8) : 3 + (i % 5);
    return {
      bbl, cls, floors, heightM: floors * 3.55, construction: false,
      cov: 0.45 + ((i * 37) % 40) / 100, year: 2004 + (i % 22),
    };
  });
  let lx = 0, ly = 0;
  for (const it of items) { const c = at.get(it.bbl); lx += c[0]; ly += c[1]; }
  const CAM = { center: [lx / items.length, ly / items.length], zoom: 18.3, pitch: 66, bearing: -20 };
  const hold = () => { try { m.stop(); m.jumpTo(CAM); L.setPlayerBuildings(items); } catch { /* mid-flight */ } };
  hold(); setInterval(hold, 500);
  await sleep(4000);

  const wall = new Map(), deck = new Map();
  L.dynGroup.traverse((o) => {
    const g = o.geometry;
    const a = g?.getAttribute?.("aStyle"), n = g?.getAttribute?.("normal"), sg = g?.getAttribute?.("aSeg");
    if (!a || !n) return;
    for (let i = 0; i < a.count; i++) {
      const flat = n.array[i * 3 + 2] > 0.9;          // a deck, not a wall
      const t = flat ? deck : wall;
      const key = flat && sg ? sg.array[i * 2] : a.array[i];
      t.set(key, (t.get(key) || 0) + 1);
    }
  });
  const show = (t) => [...t.entries()].sort((x, y) => y[1] - x[1]).map(([s, n]) => s + ":" + n).join(" ");
  console.error(`SLATE ${items.length} buildings, seed=${S().game.citySeed}`);
  console.error(`FACADES ${wall.size} families :: ${show(wall)}`);
  console.error(`DECKS   ${deck.size} surfaces :: ${show(deck)}`);
} catch (e) { console.error("SLATE ERR " + e.message + " :: " + (e.stack || "").slice(0, 300)); } })()
