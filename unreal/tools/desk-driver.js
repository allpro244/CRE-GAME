// Scripted Build desk test for -Play (-PlayScript=<this>), the simple desk
// (ui/next/BuildDesk.tsx): starts a campaign, buys a vacant commercial lot,
// holds on the lot's Overview (the city behind the page), opens Build (the
// city behind must not move; the model shows in the desk's box), then walks
// a look, a form, a drag to turn the model and a taller scheme, holding on
// each so -PlayShots catches it. Each step logs "DRIVER: <step> @<seconds>".
(async () => {
  const t0 = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(100); } };
  const say = (m) => console.log(`DRIVER: ${m} @${((Date.now() - t0) / 1000).toFixed(0)}`);
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const btn = (re, root = document) => [...root.querySelectorAll("button")].find((b) => re.test(norm(b.textContent)) && !b.disabled);
  const click = async (re, root, ms = 8000) => { const b = await until(() => btn(re, root ?? document), ms); if (!b) { say("missing " + re); return false; } b.scrollIntoView?.({ block: "center" }); b.click(); await sleep(900); return true; };
  const file = () => [...document.querySelectorAll(".nx-drawer")].find((d) => !["Inbox", "Holdings", "Pipeline", "Market", "Capital", "City", "Saves", "Settings"].includes(d.getAttribute("aria-label")));

  // the start menu, then the setup page's Break ground
  const go = await until(() => document.querySelector(".start-go:not([disabled])") || btn(/^(New campaign|New game)/), 90000);
  if (!go) { say("no start menu"); return; }
  go.click();
  if (!(await click(/^Break ground/, document, 30000))) return;
  await until(() => window.__store?.getState().phase === "playing", 120000);
  await sleep(3000);
  const s = () => window.__store.getState();
  s().setPopupsOff?.(true); s().setAlertsOff?.(true);
  say("playing");

  // a vacant commercial lot with the most demand whose owner names a price
  const lots = Object.values(s().parcels).filter((r) => r.class === "land" && !r.ag && /^C-/.test(r.zoneDist) && r.lotArea >= 8000 && !s().game.holdings[r.bbl])
    .sort((a, b) => b.demandScore - a.demandScore).slice(0, 12);
  let bbl = null;
  for (const r of lots) {
    s().approach(r.bbl);
    const ap = s().game.approaches?.[r.bbl];
    if (!ap || ap.refused || ap.ask === undefined) continue;
    s().select(r.bbl); await sleep(1200);
    await click(/^Ask \$/, file()); await click(/^Structure the stack/, file()); await click(/^Review & commit/, file());
    if (!(await click(/^Buy at /, file()))) continue;
    await sleep(800);
    if (s().game.holdings[r.bbl]) { bbl = r.bbl; break; }
  }
  if (!bbl) { say("could not buy a lot"); return; }
  say("bought " + bbl);
  await sleep(21000);
  say("overview hold (the city behind the page)");
  await click(/^Build$/, file()?.querySelector(".nx-tabs") ?? file());
  await sleep(21000);
  say("build hold (the city behind must be the same)");
  const desk = () => document.querySelector(".build-desk");
  const size = async (frac) => {
    const sl = desk()?.querySelector("input[type=range]");
    if (!sl) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(sl, String(Math.max(1, Math.round(Number(sl.max) * frac))));
    sl.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(900);
    say("size " + sl.value + " of " + sl.max + " floors");
  };
  // an office building at about two thirds of the height the lot carries
  await click(/^Office$/, desk());
  await size(0.7);
  await click(/^Brick$/, desk());
  const forms = [...(desk()?.querySelectorAll(".bd-row") ?? [])].find((r) => norm(r.querySelector(".bd-k")?.textContent) === "Form");
  const fb = forms ? [...forms.querySelectorAll("button")].filter((b) => norm(b.textContent) !== "Block")[0] : null;
  if (fb) { fb.click(); say("form " + norm(fb.textContent)); } else say("no form offered");
  await sleep(21000);
  say("brick + form hold");
  // a drag across the model box: turn it
  const box = document.querySelector(".scheme-viewer-canvas")?.getBoundingClientRect();
  if (box) {
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const ev = (type, dx, dy) => window.dispatchEvent(new PointerEvent(type, { clientX: x + dx, clientY: y + dy, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true }));
    ev("pointerdown", 0, 0);
    for (let i = 1; i <= 20; i++) { ev("pointermove", i * 12, i * 2); await sleep(30); }
    ev("pointerup", 240, 40);
    say("dragged the model 240 px");
  }
  await sleep(21000);
  say("turned hold");
  await click(/^Glass$/, desk());
  await click(/^Block$/, desk(), 2000);
  await size(1);
  await sleep(21000);
  say("glass tower hold");
  say("done");
})();
