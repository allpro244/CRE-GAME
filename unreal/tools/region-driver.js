// Scripted region player for -Play (unreal/BroadwayWall -PlayScript=<this>):
// starts a Region (6 km) campaign through the real menus, then plays the land
// developer's loop through the store the desks call — approach a farm owner,
// buy, rezone, plat, sell lots to builders — with the camera on the tract and
// the land lens on, logging each step so a run shows whether Unreal draws the
// region, the new lots and the houses the builders put up.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(150); } };
  const say = (m) => console.log("DRIVER: " + m);
  const dismiss = () => document.querySelectorAll("button").forEach((x) => {
    if (/^(Close|Continue|OK|Good\.|Got it|Dismiss|I know this|Understood|Noted|Later)$/.test(x.textContent.trim())) x.click();
  });
  const S = () => window.__store.getState();
  let flyN = 1;
  const fly = (b) => window.__store.setState({ flyTo: { bbl: b, n: Date.now() + flyN++ } });
  const hud = () => { const g = S().game; return g ? `m${g.month} cash $${(g.cash / 1e6).toFixed(2)}M` : "-"; };
  const month = async (n = 1) => { for (let i = 0; i < n; i++) { const m = S().game.month; await S().advance({ quiet: true }); await until(() => S().game.month !== m, 20000); dismiss(); } };

  say("start " + location.href + " bridge=" + !!window.ue?.bridge);
  const go = await until(() => document.querySelector(".start-go:not([disabled])"), 60000);
  if (go) go.click();
  await until(() => [...document.querySelectorAll("button")].some((b) => /Break ground/.test(b.textContent)), 30000);
  const region = [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && e.textContent.trim() === "Region (6 km)").pop();
  if (!region) { say("no Region choice on the setup page"); return; }
  region.click(); await sleep(300);
  const ten = [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && e.textContent.trim() === "$10.00M").pop();
  ten?.click(); await sleep(200);
  const t0 = Date.now();
  [...document.querySelectorAll("button")].find((b) => /Break ground/.test(b.textContent))?.click();
  if (!(await until(() => S().phase === "playing", 120000))) { say("region did not start in 120 s"); return; }
  say(`region playing in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${Object.keys(S().parcels).length} lots · ${hud()}`);
  await sleep(4000); dismiss();

  // the farm: dry, near town, room for a real plat
  const P = S().parcels;
  const farms = Object.keys(P).filter((b) => P[b].ag && P[b].tract && (P[b].buildableSf ?? 0) > 10 * 43560).sort((a, b) => P[a].tract.edgeM - P[b].tract.edgeM);
  // owners refuse often (they do not need the money): try the nearest farms in turn
  let bbl = null;
  for (const b of farms.slice(0, 12)) {
    S().approach(b); await sleep(400);
    const ap = S().game.approaches?.[b];
    if (!ap || ap.refused) { say(`${P[b].address}: owner not selling`); continue; }
    const price = ap.ask ?? Math.round(P[b].assessedLand * 1.2);
    S().buyOff(b, "cash", 1, price); await sleep(500);
    if (S().game.holdings[b]) { bbl = b; say(`bought ${P[b].address} · ${(P[b].buildableSf / 43560).toFixed(0)} buildable ac · ${P[b].tract.edgeM} m out · $${Math.round(price / 1e3)}K · ${hud()}`); break; }
    say(`${P[b].address}: offer at $${Math.round(price / 1e3)}K not taken`);
  }
  if (!bbl) { say("no farm owner would sell"); return; }
  S().select(bbl); fly(bbl); await sleep(22000);
  S().setLens("land"); await sleep(4000);

  // rezone (refile once after the bar if refused), then the streets
  for (let attempt = 0; attempt < 3 && !S().game.rezoned?.[bbl]; attempt++) {
    S().fileRezoning(bbl, 7500); await sleep(300);
    if (!S().game.entitlementApps?.[bbl]) { say("could not file; waiting 12 months"); await month(12); continue; }
    say(`rezoning filed · decides month ${S().game.entitlementApps[bbl].decideM}`);
    await until(() => false, 1);
    while (S().game.entitlementApps?.[bbl]) await month(1);
    say(S().game.rezoned?.[bbl] ? `rezoned · ${hud()}` : `refused · ${hud()}`);
  }
  if (!S().game.rezoned?.[bbl]) { say("never rezoned"); return; }
  S().buildPlat(bbl); await sleep(500);
  if (!S().game.plats?.[bbl]) { say("plat did not start"); return; }
  say(`streets going in · done month ${S().game.plats[bbl].doneM}`);
  S().setLens("none");
  while (!S().game.plats[bbl].done) await month(1);
  const lots = Object.keys(S().parcels).filter((b) => S().parcels[b].block === bbl);
  say(`streets in · ${lots.length} lots · ${Object.keys(S().parcels).length} lots in town · ${hud()}`);
  if (lots[0]) { S().select(lots[0]); fly(lots[Math.floor(lots.length / 2)]); }
  await sleep(25000);

  // sell to the builders and watch houses go up
  for (let i = 0; i < 24; i++) {
    const off = S().game.homes?.offers?.[bbl];
    if (off) { S().takeLotOffer(bbl); say(`took ${off.builder ?? "a builder"}'s offer · ${hud()}`); }
    else if (i === 6 && !S().game.homes?.listed?.[bbl] && lots.some((b) => S().game.holdings[b])) { const lot = S().parcels[lots[0]]; const bid = lot ? (lot.assessedLand / lot.lotArea) : 1; S().listLots(bbl, +(bid * 1.0).toFixed(2), true); say(`no offers in 6 months; listed the plat at $${bid.toFixed(2)}/sf`); }
    await month(1);
  }
  const houses = lots.filter((b) => (S().game.built?.[b] || (S().parcels[b]?.bldgArea ?? 0) > 0)).length;
  say(`two years on: ${houses} of ${lots.length} lots carry a house · ${hud()}`);
  fly(lots[Math.floor(lots.length / 2)]); await sleep(22000);
  S().setLens("owners"); await sleep(22000);
  say("done");
})();
