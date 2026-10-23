// Scripted player for -Play (unreal/BroadwayWall -PlayScript=<this>): starts a
// campaign through the real menus, buys the docket's suggested first building
// (offer, commit, close) the way a player does, then plays three years a month
// at a time, dismissing every card, so the screenshots show the desks over the
// 3D city with the economy running and the player's building on the map.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(100); } };
  const say = (m) => console.log("DRIVER: " + m);
  const btn = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent.trim()) && !b.disabled);
  const click = async (re, ms = 8000) => { const b = await until(() => btn(re), ms); if (!b) return false; b.scrollIntoView?.(); b.click(); await sleep(900); return true; };
  // every card the game raises asks for one of these
  const dismiss = () => document.querySelectorAll("button").forEach((x) => {
    if (/^(Close|Continue|OK|Good\.|Got it|Dismiss|I know this|Understood|Noted)$/.test(x.textContent.trim())) x.click();
  });
  const top = () => (document.querySelector("header")?.textContent ?? "").replace(/\s+/g, " ").slice(0, 160);

  say("start " + location.href + " bridge=" + !!window.ue?.bridge);
  const go = await until(() => document.querySelector(".start-go:not([disabled])"), 60000);
  if (!go) { say("no start menu"); return; }
  go.click();
  if (!(await click(/Break ground/, 30000))) { say("no setup page"); return; }
  await until(() => document.querySelector(".advance-main"), 120000);
  say("playing · " + top());
  await sleep(1500);
  dismiss();

  // THE FIRST DEAL: the docket's "Start here" building
  const steps = [/^Start here:/, /^Make an offer/, /^Offer \$/, /^Commit$/, /^Close at \$/];
  let bought = true;
  for (const re of steps)
    if (!(await click(re, 15000))) {
      bought = false;
      say("buy step failed: " + re + " · buttons: " + [...document.querySelectorAll("button")].map((b) => b.textContent.trim().slice(0, 40)).filter(Boolean).slice(0, 60).join(" | "));
      break;
    }
  say(bought ? "bought · " + top() : "could not buy the suggested building");
  await click(/^Close /, 2000);

  for (let i = 0; i < 36; i++) {
    dismiss();
    await sleep(2500);
    const b = document.querySelector(".advance-main");
    if (b && !b.disabled) b.click();
    if (i % 6 === 5) say("month " + (i + 1) + " · " + top());
  }
  say("done · " + top());
})();
