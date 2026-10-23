// Scripted Build desk test for -Play (-PlayScript=<this>): starts a campaign,
// buys the first vacant lot on the marketplace, opens the Build desk, picks a
// mid-rise and walks the Design tab through a few facade styles, holding on
// each so the -PlayShots screenshots catch Unreal's model of the scheme.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(100); } };
  const say = (m) => console.log("DRIVER: " + m);
  const btn = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent.trim()) && !b.disabled);
  const click = async (re, ms = 10000) => { const b = await until(() => btn(re), ms); if (!b) { say("missing: " + re); return false; } b.scrollIntoView?.(); b.click(); await sleep(1200); return true; };

  const go = await until(() => document.querySelector(".start-go:not([disabled])"), 60000);
  if (!go) { say("no start menu"); return; }
  go.click();
  if (!(await click(/Break ground/, 30000))) return;
  await until(() => document.querySelector(".advance-main"), 120000);
  await sleep(2000);
  document.querySelectorAll("button").forEach((x) => { if (/^(I know this|Understood|Got it)$/.test(x.textContent.trim())) x.click(); });

  if (!(await click(/Marketplace/))) return;
  await sleep(2000);
  await until(() => [...document.querySelectorAll("tr")].some((r) => /Vacant Land/.test(r.textContent)), 10000);
  let got = false;
  for (let n = 0; n < 4 && !got; n++) {
    if (n) { await click(/Marketplace/); await sleep(2000); }
    const row = [...document.querySelectorAll("tr")].filter((r) => /Vacant Land/.test(r.textContent))[n];
    if (!row) break;
    ([...row.querySelectorAll("button,a,span")].find((e) => /Open/.test(e.textContent)) ?? row).click();
    await sleep(2500);
    got = true;
    for (const re of [/^Make an offer/, /^Offer \$/]) if (!(await click(re, 6000))) { got = false; break; }
    // a lot bought outright may skip the financing stack
    if (got) { await click(/^Commit$/, 3000); if (!(await click(/^Close at \$/, 6000))) got = false; }
  }
  if (!got) { say("could not buy a lot"); return; }
  say("bought a lot");
  if (!(await click(/^Open the Build desk/))) return;
  await click(/^mid$/, 4000);
  if (!(await click(/^Next · Design/))) return;
  document.querySelector(".scheme-viewer")?.scrollIntoView();
  say("on the design tab");
  // the kit picker (Unreal host): a few kits, then a colour, a street floor and a top on the last
  const byTitle = (re) => [...document.querySelectorAll("button[title]")].find((b) => re.test(b.title) && !b.disabled);
  for (const name of [/^Terra cotta commercial/, /^Painted brick walk-up/, /^Deco stone/, /^Dark glass curtain wall/]) {
    const k = byTitle(name);
    if (!k) { say("no kit " + name.source); continue; }
    k.scrollIntoView(); k.click();
    say("kit " + k.title);
    await sleep(14000);
  }
  byTitle(/^Arched red brick/)?.click();
  await sleep(1500);
  await click(/Red$/, 3000);
  await click(/^Shopfronts$/, 3000);
  await click(/^Plain parapet$/, 3000);
  say("brick, red, shopfronts, plain parapet");
  await sleep(14000);
  say("done");
})();
