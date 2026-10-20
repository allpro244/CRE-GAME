// Scripted player for -Play (unreal/BroadwayWall -PlayScript=<this>): starts a
// campaign through the real menus, then advances a month every few seconds, so
// the screenshots show the desks over the 3D city with the economy running.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(100); } };
  const say = (m) => console.log("DRIVER: " + m);
  say("start " + location.href + " bridge=" + !!window.ue?.bridge);
  const go = await until(() => document.querySelector(".start-go:not([disabled])"), 60000);
  if (!go) { say("no start menu"); return; }
  go.click();
  const ground = await until(() => [...document.querySelectorAll("button")].find((b) => /Break ground/.test(b.textContent) && !b.disabled), 30000);
  if (!ground) { say("no setup page"); return; }
  ground.click();
  await until(() => document.querySelector(".advance-main"), 120000);
  say("playing");
  for (let i = 0; i < 24; i++) {
    await sleep(3500);
    const b = document.querySelector(".advance-main");
    if (b && !b.disabled) b.click();
    document.querySelectorAll("button").forEach((x) => { if (/^(Close|Continue|OK|Got it|Dismiss|I know this)$/.test(x.textContent.trim())) x.click(); });
    say("month " + i);
  }
})();
