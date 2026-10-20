// Spike A driver, injected into the web game running inside Unreal's browser
// widget (BWSpike -SpikeA=<url> -SpikeAScript=<this file>). Reports over the
// JS->C++ bridge (window.ue.bridge.report). Two launches:
//   run 1  new game -> time 12 single months -> autosave lands in IndexedDB
//   run 2  (fresh process) Continue -> confirm the same month came back
(async () => {
  const t0 = performance.now();
  const say = (m) => { console.log("BW: " + m); const b = window.ue?.bridge; if (b) { try { b.report(String(m)); } catch (e) { console.log("BW: bridge error " + e); } } else if (/^(SHOT:|QUIT$)/.test(m)) console.log("BWCMD:" + m); };
  const shot = async (n) => { say("SHOT:" + n); await sleep(1500); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, what) => {
    const end = performance.now() + ms;
    for (;;) { const v = fn(); if (v) return v; if (performance.now() > end) throw new Error("timeout: " + what); await sleep(50); }
  };
  const monthText = () => (document.querySelector(".topbar-vital")?.textContent ?? "").match(/[A-Z][a-z]{2,8} \d{4}/)?.[0] ?? null;
  setTimeout(() => { say("FAIL watchdog 15 min"); say("QUIT"); }, 15 * 60 * 1000);

  try {
    say(`PAGE href=${location.href} ready=${document.readyState} title=${document.title} body=${document.body?.innerHTML.length ?? -1} scripts=${document.scripts.length}`);
    for (let i = 0; i < 0; i++) { await sleep(5000); say(`PAGE+${(i + 1) * 5}s href=${location.href} ready=${document.readyState} body=${document.body?.innerHTML.length ?? -1} root=${document.getElementById("root")?.innerHTML.length ?? -1}`); }
    // --- what this Chromium can do
    const gl2 = !!document.createElement("canvas").getContext("webgl2");
    let modWorker = false;
    try { const w = new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" })), { type: "module" }); modWorker = await new Promise((r) => { w.onmessage = () => r(true); setTimeout(() => r(false), 3000); }); w.terminate(); } catch { /* no */ }
    const idb = await new Promise((r) => { try { const q = indexedDB.open("bw-probe", 1); q.onsuccess = () => { q.result.close(); r(true); }; q.onerror = () => r(false); } catch { r(false); } });
    const mem = navigator.deviceMemory ?? "?";
    say(`ENV bridge=${!!window.ue?.bridge} ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]} webgl2=${gl2} moduleWorker=${modWorker} indexedDB=${idb} cores=${navigator.hardwareConcurrency} mem=${mem}GB origin=${location.origin}`);

    // --- menu
    await until(() => document.querySelector(".start-go:not([disabled])") || document.querySelector(".start-continue"), 120000, "start menu");
    say(`menu up at ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    const cont = document.querySelector(".start-continue");
    const expected = localStorage.getItem("bwspike:month");

    if (cont && expected) {
      // ---- run 2: load the autosave written by run 1
      const tl = performance.now();
      cont.click();
      const got = await until(monthText, 120000, "game after Continue");
      say(`LOAD continue -> ${got} (saved ${expected}) in ${((performance.now() - tl) / 1000).toFixed(1)}s => ${got === expected ? "PASS" : "MISMATCH"}`);
      await sleep(2500);
      await shot("spikeA-3-loaded");
      localStorage.removeItem("bwspike:month");
      say("QUIT");
      return;
    }

    // ---- run 1: new game (?size=metro picks the island size on the setup page)
    const SIZE = new URLSearchParams(location.search).get("size");
    const tag = SIZE ? "-" + SIZE : "";
    if (SIZE) localStorage.setItem("bw:size:" + (localStorage.getItem("bw:city") || "somewhere"), SIZE);
    await shot("spikeA-0-menu" + tag);
    document.querySelector(".start-go").click();
    const go = await until(() => [...document.querySelectorAll("button")].find((b) => /Break ground/.test(b.textContent) && !b.disabled), 30000, "setup page");
    const lots = [...document.querySelectorAll(".start-opt-on")].map((b) => b.textContent.trim()).join(" | ").slice(0, 200);
    await shot("spikeA-1-setup" + tag);
    const tg = performance.now();
    go.click();
    const m0 = await until(monthText, 300000, "playing");
    say(`NEWGAME size=${SIZE ?? "default"} picked=[${lots}] city generated + game started in ${((performance.now() - tg) / 1000).toFixed(1)}s at ${m0}`);
    await sleep(4000);
    await shot("spikeA-2-playing" + tag);

    // ---- a year, one month at a time
    const times = [];
    for (let i = 0; i < 12; i++) {
      const before = monthText();
      const btn = await until(() => { const b = document.querySelector(".advance-main"); return b && !b.disabled && b; }, 120000, "advance enabled");
      const ts = performance.now();
      btn.click();
      await until(() => monthText() !== before, 120000, "month to turn");
      times.push(performance.now() - ts);
      // a modal (year review, decision) can block the next click: close what we can
      await sleep(150);
      document.querySelectorAll("button").forEach((b) => { if (/^(Close|Continue|OK|Got it|Dismiss|×|✕)$/.test(b.textContent.trim()) && !b.closest(".topbar")) b.click(); });
    }
    const s = [...times].sort((a, b) => a - b);
    say(`YEAR ${monthText()} month ms: median=${s[6].toFixed(0)} min=${s[0].toFixed(0)} max=${s[11].toFixed(0)} all=${times.map((t) => t.toFixed(0)).join(",")}`);
    await sleep(2000);
    await shot("spikeA-2b-after-year" + tag);

    // ---- did the autosave land in IndexedDB?
    await sleep(3000);
    const keys = await new Promise((r) => { const q = indexedDB.open("broadway-and-wall"); q.onsuccess = () => { const db = q.result; const names = [...db.objectStoreNames]; if (!names.length) return r([]); const tx = db.transaction(names[0]); const k = tx.objectStore(names[0]).getAllKeys(); k.onsuccess = () => r(k.result); k.onerror = () => r(["err"]); }; q.onerror = () => r(["open-failed"]); });
    say(`SAVE idb keys=${JSON.stringify(keys).slice(0, 200)}`);
    if (!SIZE) localStorage.setItem("bwspike:month", monthText());
    say("QUIT");
  } catch (e) {
    say("FAIL " + (e?.stack ?? e));
    await shot("spikeA-fail");
    say("QUIT");
  }
})();
