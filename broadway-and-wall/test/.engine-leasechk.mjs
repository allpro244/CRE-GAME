// src/engine/types.ts
var BUILT_CLASSES = ["office", "retail", "multifamily", "industrial"];
function logBooks(s, key, amt) {
  if (!s.books) s.books = [];
  const yr = Math.floor(s.month / 12);
  let e = s.books[s.books.length - 1];
  if (!e || e.yr !== yr) {
    e = { yr, noi: 0, debtSvc: 0, leasing: 0, capex: 0, dev: 0, taxes: 0, bought: 0, sold: 0, ga: 0, interest: 0 };
    s.books.push(e);
  }
  e[key] = (e[key] ?? 0) + amt;
}
var START_CASH = 6e6;
var START_YEAR = 2e3;
var CASH_APY = 0.01;
var CENTURY_MONTHS = 1200;
var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(m) {
  return `${MONTH_NAMES[(m % 12 + 12) % 12]} ${START_YEAR + Math.floor(m / 12)}`;
}

// src/engine/market.ts
function mulberry32Step(a) {
  a |= 0;
  a = a + 1831565813 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return { state: a, value: ((t ^ t >>> 14) >>> 0) / 4294967296 };
}
function rng(s) {
  const r = mulberry32Step(s.rng);
  s.rng = r.state;
  return r.value;
}
var rrange = (s, a, b) => a + (b - a) * rng(s);
var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
var SECTORS = [
  "finance",
  "law",
  "tech",
  "media",
  "insurance",
  "logistics",
  "apparel",
  "food",
  "medical",
  "design"
];
var INDUSTRY_VOL = {
  tech: 2,
  media: 1.6,
  finance: 1.4,
  apparel: 1.3,
  design: 1.2,
  logistics: 1.05,
  food: 0.8,
  law: 0.7,
  medical: 0.6,
  insurance: 0.5
};
var INDUSTRY_LABEL = {
  finance: "Finance",
  law: "The law firms",
  tech: "Technology",
  media: "Media",
  insurance: "Insurance",
  logistics: "Shipping and logistics",
  apparel: "Apparel and retail trade",
  food: "Food and hospitality",
  medical: "Medical",
  design: "Architecture and design"
};
function industryStress(e, k) {
  const mom = e.industryMom?.[k] ?? 0;
  return clamp(-mom / 0.03, 0, 1);
}
function industryPull(e, k) {
  const mom = e.industryMom?.[k] ?? 0;
  return clamp(1 + mom * 22, 0.35, 1.9);
}
var PHASE_CFG = {
  recovery: { rateGap: -0.75, rentDrift: 14e-4, devDrift: 0.034, nextM: [12, 24], next: "expansion" },
  expansion: { rateGap: 0.35, rentDrift: 37e-4, devDrift: 0.027, nextM: [24, 54], next: "peak" },
  peak: { rateGap: 1.95, rentDrift: 14e-4, devDrift: 0.014, nextM: [6, 15], next: "recession" },
  recession: { rateGap: -1.05, rentDrift: -47e-4, devDrift: -0.054, nextM: [12, 24], next: "recovery" }
};
var RATE_FLOOR = 1.9;
var RATE_CEIL = 15.5;
var CAP_BASE = { office: 5.3, retail: 5.91, multifamily: 4.76, industrial: 6.74 };
var CAP_VAC_BETA = {
  office: 0.12,
  retail: 0.09,
  multifamily: 0.06,
  industrial: 0.08
};
var CITY_STOCK = { office: 5e6, retail: 2e6, multifamily: 7e6, industrial: 15e5 };
function stockFromParcels(parcels) {
  const out = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
  for (const bbl in parcels) {
    const r = parcels[bbl];
    if (!r || r.class === "land" || !r.bldgArea) continue;
    const m = r.mix;
    if (m) {
      for (const k of BUILT_CLASSES) out[k] += r.bldgArea * (m[k] ?? 0);
    } else if (r.class in out) {
      out[r.class] += r.bldgArea;
    }
  }
  for (const k of BUILT_CLASSES) out[k] = Math.max(12e5, Math.round(out[k]));
  return out;
}
var SECTOR_LABEL = { office: "Office", retail: "Retail", multifamily: "Apartments", industrial: "Industrial" };
var RENT_BASE = { office: 62, retail: 88, multifamily: 46, industrial: 16 };
var NATURAL_VAC = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 };
var BUILD_MONTHS = { office: [30, 44], retail: [18, 28], multifamily: [22, 34], industrial: [12, 20] };
function initEcon(s, parcels) {
  const CITY = parcels ? stockFromParcels(parcels) : { ...CITY_STOCK };
  const econ = {
    indexRate: 5.4,
    phase: "expansion",
    phaseMLeft: 0,
    rumoredPhase: null,
    cycleDev: 0.1,
    landIdx: 1,
    capRate: { office: CAP_BASE.office, retail: CAP_BASE.retail, multifamily: CAP_BASE.multifamily, industrial: CAP_BASE.industrial },
    rentIdx: { office: RENT_BASE.office, retail: RENT_BASE.retail, multifamily: RENT_BASE.multifamily, industrial: RENT_BASE.industrial },
    costIdx: 1,
    sectorMom: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    pipeline: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    starts: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    creditIdx: 1,
    employIdx: 1,
    stock: { ...CITY },
    baseStock: { ...CITY },
    occupied: {
      office: CITY.office * (1 - NATURAL_VAC.office),
      retail: CITY.retail * (1 - NATURAL_VAC.retail),
      multifamily: CITY.multifamily * (1 - NATURAL_VAC.multifamily),
      industrial: CITY.industrial * (1 - NATURAL_VAC.industrial)
    },
    cityVac: { ...NATURAL_VAC },
    absorb12: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    cohorts: { office: [], retail: [], multifamily: [], industrial: [] },
    completions12: { office: 0, retail: 0, multifamily: 0, industrial: 0 },
    history: []
  };
  econ.phaseMLeft = Math.round(12 + 30 * rng(s));
  recordHistory(econ, 0);
  return econ;
}
function pushNews(s, kind, text) {
  s.news.unshift({ q: s.month, kind, text });
  if (s.news.length > 120) s.news.length = 120;
}
var RUMORS = {
  expansion: [
    "Leasing brokers report tour volume up for a third straight quarter.",
    "Debt desks are quoting tighter spreads \u2014 money wants in."
  ],
  peak: [
    "A record bid for a Midtown tower has appraisers raising eyebrows.",
    "Lenders start asking harder questions about pro-forma rents."
  ],
  recession: [
    "Sublease space is quietly piling up downtown.",
    "Two regional banks pulled term sheets this week, sources say."
  ],
  recovery: [
    "Distressed buyers are circling \u2014 the smart money smells a bottom.",
    "First green shoots: concessions burning off in the best buildings."
  ]
};
function tickEcon(s) {
  s.econ.m = s.month;
  const e = s.econ;
  const cfg = PHASE_CFG[e.phase];
  e.phaseMLeft--;
  if (e.phaseMLeft <= 6 && !e.rumoredPhase && rng(s) < 0.25) {
    e.rumoredPhase = cfg.next;
    pushNews(s, "rumor", RUMORS[cfg.next][Math.floor(rng(s) * RUMORS[cfg.next].length)]);
  }
  if (e.phaseMLeft <= 0) {
    e.phase = cfg.next;
    e.rumoredPhase = null;
    const [lo, hi] = PHASE_CFG[e.phase].nextM;
    e.phaseMLeft = Math.round(lo + (hi - lo) * rng(s));
    const label = {
      expansion: "The expansion is on \u2014 rents push, capital chases.",
      peak: "The market has topped out. Everything is priced to perfection.",
      recession: "The turn is here: tenants retrench, lenders retreat.",
      recovery: "The bleeding has stopped. Recovery begins at the bottom of the stack."
    };
    pushNews(s, "event", label[e.phase]);
  }
  const c2 = PHASE_CFG[e.phase];
  if (e.rateRegime === void 0) {
    e.rateRegime = 5.4;
    e.rateAimTo = 5.4;
    e.rateAimM = s.month + 180;
  }
  if (s.month >= (e.rateAimM ?? 0)) {
    const was = e.rateAimTo ?? 5.4;
    e.rateAimTo = rrange(s, 2.4, 11);
    e.rateAimM = s.month + Math.round(rrange(s, 150, 320));
    if (Math.abs(e.rateAimTo - was) > 1.6) {
      pushNews(s, e.rateAimTo > was ? "warn" : "event", e.rateAimTo > was ? "The cost of money is turning. Economists are talking about a decade of dearer credit." : "A new monetary era: money is getting cheaper, and everything with a yield is about to be repriced.");
    }
  }
  e.rateRegime = clamp(e.rateRegime + 0.012 * ((e.rateAimTo ?? 5.4) - e.rateRegime), RATE_FLOOR, RATE_CEIL);
  if (rng(s) < 35e-4) {
    const jump = rrange(s, 1.1, 3.2) * (rng(s) < 0.55 ? 1 : -1);
    e.rateRegime = clamp(e.rateRegime + jump, RATE_FLOOR, RATE_CEIL);
    pushNews(s, jump > 0 ? "warn" : "event", jump > 0 ? "An inflation scare. The index jumped this month and every floating coupon in the city went with it." : "The central bank cut hard and unexpectedly. Refinancing windows are open that were shut last month.");
  }
  e.indexRate = clamp(
    e.indexRate + 0.075 * (e.rateRegime + c2.rateGap - e.indexRate) + rrange(s, -0.13, 0.13),
    RATE_FLOOR,
    RATE_CEIL
  );
  e.cycleDev = clamp(e.cycleDev + c2.devDrift + rrange(s, -0.03, 0.03), -1, 1);
  const creditTarget = e.phase === "expansion" ? 1.12 : e.phase === "peak" ? 1 : e.phase === "recession" ? 0.54 : 0.88;
  const creditSpeed = creditTarget < e.creditIdx ? 0.16 : 0.055;
  e.creditIdx = clamp(e.creditIdx + creditSpeed * (creditTarget - e.creditIdx) + rrange(s, -0.012, 0.012), 0.4, 1.25);
  if (e.creditIdx < 0.66 && rng(s) < 0.02) {
    pushNews(s, "warn", "The debt markets have effectively closed. Term sheets are being pulled mid-deal.");
  }
  const jobDrift = e.phase === "expansion" ? 26e-4 : e.phase === "peak" ? 8e-4 : e.phase === "recession" ? -31e-4 : 15e-4;
  e.employIdx = clamp(e.employIdx * (1 + jobDrift + rrange(s, -12e-4, 12e-4)), 0.55, 12);
  {
    if (e.population === void 0) {
      e.population = 24e4;
      e.jobs = 132e3;
      e.unemployment = 0.052;
      e.wageIdx = 1;
      e.outputIdx = 1;
      e.cpi = 1;
    }
    const prevJobs = e.jobs;
    e.jobs = Math.round(132e3 * e.employIdx);
    const jobGrowth = prevJobs > 0 ? e.jobs / prevJobs - 1 : 0;
    const labourForce = e.population * 0.62;
    const slackTarget = clamp(1 - e.jobs / Math.max(1, labourForce), 0.018, 0.24);
    e.unemployment = clamp(e.unemployment + 0.18 * (slackTarget - e.unemployment), 0.015, 0.26);
    const pull = jobGrowth > 0 ? 0.35 : 0.09;
    e.population = Math.round(clamp(e.population * (1 + jobGrowth * pull + 35e-5), 6e4, 4e6));
    const tight = 0.055 - e.unemployment;
    e.wageIdx = clamp(e.wageIdx * (1 + 35e-5 + tight * 0.014 + rrange(s, -4e-4, 4e-4)), 0.7, 6);
    e.cpi = clamp(e.cpi * (1 + 16e-4 + (e.phase === "peak" ? 11e-4 : e.phase === "recession" ? -7e-4 : 0)), 0.8, 40);
    e.outputIdx = +(e.jobs / 132e3 * e.wageIdx).toFixed(4);
  }
  if (!e.sectorPhase) {
    e.sectorPhase = { office: "steady", retail: "steady", multifamily: "steady", industrial: "steady" };
    e.sectorPhaseM = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    for (const k of BUILT_CLASSES) e.sectorPhaseM[k] = Math.round(rrange(s, 8, 60));
  }
  const SECTOR_AIM = { boom: 0.0125, steady: 0, bust: -0.0115 };
  for (const k of BUILT_CLASSES) {
    if ((e.sectorPhaseM[k] -= 1) <= 0) {
      const cur = e.sectorPhase[k];
      const gap = (e.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k];
      const tight = clamp(0.5 - gap * 6, 0.1, 0.9);
      let nextPhase;
      if (cur === "steady") nextPhase = rng(s) < tight ? "boom" : "bust";
      else if (cur === "boom") nextPhase = rng(s) < 0.45 ? "bust" : "steady";
      else nextPhase = rng(s) < 0.72 ? "steady" : "boom";
      e.sectorPhase[k] = nextPhase;
      e.sectorPhaseM[k] = Math.round(
        nextPhase === "boom" ? rrange(s, 20, 56) : nextPhase === "bust" ? rrange(s, 16, 42) : rrange(s, 26, 74)
      );
      if (nextPhase !== "steady" && cur !== nextPhase) {
        pushNews(s, nextPhase === "boom" ? "event" : "warn", nextPhase === "boom" ? `${SECTOR_LABEL[k]} is turning. Tenants in that sector are expanding hard and every landlord in it knows.` : `${SECTOR_LABEL[k]} demand is rolling over. Brokers are quietly cutting asking rents.`);
      }
    }
    const aim = SECTOR_AIM[e.sectorPhase[k]];
    e.sectorMom[k] = clamp(e.sectorMom[k] + 0.055 * (aim - e.sectorMom[k]) + rrange(s, -6e-4, 6e-4), -0.02, 0.02);
  }
  if (!e.industryPhase) {
    e.industryPhase = {};
    e.industryPhaseM = {};
    e.industryMom = {};
    for (const k of SECTORS) {
      e.industryPhase[k] = "steady";
      e.industryPhaseM[k] = Math.round(rrange(s, 6, 70));
      e.industryMom[k] = 0;
    }
  }
  for (const k of SECTORS) {
    const vol = INDUSTRY_VOL[k];
    if ((e.industryPhaseM[k] -= 1) <= 0) {
      const cur = e.industryPhase[k];
      const macro = e.phase === "recession" ? -0.22 : e.phase === "recovery" ? 0.06 : e.phase === "expansion" ? 0.14 : -0.06;
      const up = clamp(0.45 + macro, 0.12, 0.85);
      let next;
      if (cur === "steady") next = rng(s) < up ? "boom" : "bust";
      else if (cur === "boom") next = rng(s) < 0.5 ? "bust" : "steady";
      else next = rng(s) < 0.7 ? "steady" : "boom";
      e.industryPhase[k] = next;
      const len = next === "boom" ? rrange(s, 18, 48) : next === "bust" ? rrange(s, 12, 36) : rrange(s, 30, 96);
      e.industryPhaseM[k] = Math.round(len / Math.max(0.6, vol));
      if (next !== "steady" && cur !== next) {
        pushNews(s, next === "boom" ? "event" : "warn", next === "boom" ? `${INDUSTRY_LABEL[k]} is hiring hard. Anyone with space let to that trade is about to have a good few years.` : `${INDUSTRY_LABEL[k]} is in trouble. Look at how much of your rent roll depends on it before somebody hands you the keys.`);
      }
    }
    const aim = (e.industryPhase[k] === "boom" ? 0.016 : e.industryPhase[k] === "bust" ? -0.015 : 0) * vol;
    e.industryMom[k] = clamp(
      e.industryMom[k] + 0.05 * (aim - e.industryMom[k]) + rrange(s, -8e-4, 8e-4) * vol,
      -0.05,
      0.05
    );
  }
  const monthAbs = {};
  const monthComp = {};
  const unmet = {};
  for (const k of BUILT_CLASSES) {
    const stk = e.stock?.[k] ?? CITY_STOCK[k];
    const vacNow = e.cityVac?.[k] ?? NATURAL_VAC[k];
    const margin = e.rentIdx[k] / RENT_BASE[k] / e.costIdx - 1;
    const gain = k === "multifamily" ? 22 : 17;
    const ceiling = k === "multifamily" ? 2.3 : 1.7;
    const vacGate = clamp(1 - gain * (vacNow - NATURAL_VAC[k]), 0.08, ceiling);
    const appetite = Math.max(0, margin + 0.06 * e.cycleDev) * e.creditIdx * vacGate;
    const start = stk * 16e-4 * Math.min(2.4, appetite * 5) * (0.7 + 0.6 * rng(s));
    e.starts[k] = Math.round(start);
    if (!e.cohorts) e.cohorts = { office: [], retail: [], multifamily: [], industrial: [] };
    if (!e.completions12) e.completions12 = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    const [bLo, bHi] = BUILD_MONTHS[k];
    if (start > 1) e.cohorts[k].push({ m: s.month + bLo + Math.round(rng(s) * (bHi - bLo)), sf: Math.round(start) });
    let delivered = 0;
    e.cohorts[k] = e.cohorts[k].filter((c) => {
      if (c.m <= s.month) {
        delivered += c.sf;
        return false;
      }
      return true;
    });
    e.pipeline[k] = e.cohorts[k].reduce((a, c) => a + c.sf, 0);
    e.completions12[k] = e.completions12[k] * (11 / 12) + delivered;
    e.supplyPress = e.supplyPress ?? {};
    e.supplyPress[k] = delivered / stk;
    if (!e.stock) e.stock = { ...CITY_STOCK };
    if (!e.occupied) e.occupied = {
      office: CITY_STOCK.office * (1 - NATURAL_VAC.office),
      retail: CITY_STOCK.retail * (1 - NATURAL_VAC.retail),
      multifamily: CITY_STOCK.multifamily * (1 - NATURAL_VAC.multifamily),
      industrial: CITY_STOCK.industrial * (1 - NATURAL_VAC.industrial)
    };
    if (!e.cityVac) e.cityVac = { ...NATURAL_VAC };
    if (!e.absorb12) e.absorb12 = { office: 0, retail: 0, multifamily: 0, industrial: 0 };
    e.stock[k] = stk + delivered;
    const elastic = k === "office" ? 1 : k === "industrial" ? 0.9 : k === "retail" ? 0.7 : 0.75;
    const affordability = Math.pow(
      e.rentIdx[k] / RENT_BASE[k] / Math.max(0.35, e.employIdx),
      k === "multifamily" ? -0.62 : -0.58
    );
    const target2 = (e.baseStock?.[k] ?? CITY_STOCK[k]) * (1 - NATURAL_VAC[k]) * Math.pow(e.employIdx, elastic) * (1 + e.sectorMom[k] * 11) * affordability;
    const absorb = clamp(0.055 * (target2 - e.occupied[k]), -5e-3 * e.stock[k], 9e-3 * e.stock[k]) + e.stock[k] * rrange(s, -6e-4, 6e-4);
    unmet[k] = Math.max(0, (target2 - e.occupied[k]) / Math.max(1, e.stock[k]));
    const frictionRatio = k === "industrial" ? 0.22 : k === "multifamily" ? 0.3 : 0.32;
    const friction = NATURAL_VAC[k] * frictionRatio;
    e.occupied[k] = clamp(e.occupied[k] + absorb, e.stock[k] * 0.55, e.stock[k] * (1 - friction));
    e.cityVac[k] = clamp(1 - e.occupied[k] / e.stock[k], friction, 0.45);
    e.absorb12[k] = e.absorb12[k] * (11 / 12) + absorb;
    monthAbs[k] = absorb;
    monthComp[k] = delivered;
  }
  for (const k of BUILT_CLASSES) {
    const vol = k === "multifamily" ? 2e-3 : k === "office" ? 4e-3 : k === "industrial" ? 24e-4 : 3e-3;
    const gap = (e.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k];
    const vacTerm = clamp(-gap * 0.09, -9e-3, 9e-3);
    const scarcity = clamp((unmet[k] ?? 0) * 0.078, 0, 0.013);
    const drift = c2.rentDrift * 0.55 + e.sectorMom[k] * 0.42 + vacTerm + scarcity + jobDrift * 0.35;
    e.rentIdx[k] = Math.max(RENT_BASE[k] * 0.5, e.rentIdx[k] * (1 + drift + rrange(s, -vol, vol)));
  }
  for (const k of BUILT_CLASSES) {
    const crunch = 1.6 * Math.max(0, 1 - e.creditIdx);
    const sector = -30 * e.sectorMom[k];
    const vacGap = (e.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k];
    const vacRisk = clamp(CAP_VAC_BETA[k] * vacGap * 100, -0.6, 2);
    const target2 = CAP_BASE[k] + 0.38 * (e.indexRate - 5.4) - 0.25 * e.cycleDev + crunch + sector + vacRisk;
    e.capRate[k] = clamp(e.capRate[k] + 0.1 * (target2 - e.capRate[k]) + rrange(s, -0.045, 0.045), 3.4, 11);
  }
  const rentLevel = e.rentIdx.office / RENT_BASE.office;
  const target = Math.pow(rentLevel, 1.15) * (1 + 0.16 * e.cycleDev);
  e.landIdx = clamp(e.landIdx + 0.024 * (target - e.landIdx) + e.landIdx * rrange(s, -3e-3, 3e-3), 0.3, 40);
  const costDrift = c2.rentDrift * 0.55 + (e.phase === "recession" ? 5e-4 : 2e-4);
  e.costIdx = clamp(e.costIdx * (1 + costDrift + rrange(s, -15e-4, 15e-4)), 0.6, 60);
  recordHistory(e, s.month, monthAbs, monthComp);
}
function addStock(e, k, sf) {
  if (!e.stock) e.stock = { ...CITY_STOCK };
  e.stock[k] = (e.stock[k] ?? CITY_STOCK[k]) + Math.max(0, sf);
}
function vacancyPull(e, use) {
  const vac = e.cityVac?.[use] ?? NATURAL_VAC[use];
  return Math.max(0.4, Math.min(1.7, Math.pow(NATURAL_VAC[use] / Math.max(5e-3, vac), 0.9)));
}
function recordHistory(e, q, abs, comp) {
  e.history.push({
    q,
    indexRate: +e.indexRate.toFixed(2),
    landIdx: +e.landIdx.toFixed(4),
    cycleDev: +e.cycleDev.toFixed(3),
    capOffice: +e.capRate.office.toFixed(2),
    rentOffice: +e.rentIdx.office.toFixed(2),
    creditIdx: +e.creditIdx.toFixed(3),
    employIdx: +e.employIdx.toFixed(3),
    population: e.population,
    jobs: e.jobs,
    unemployment: e.unemployment !== void 0 ? +e.unemployment.toFixed(4) : void 0,
    wageIdx: e.wageIdx !== void 0 ? +e.wageIdx.toFixed(4) : void 0,
    outputIdx: e.outputIdx,
    cpi: e.cpi !== void 0 ? +e.cpi.toFixed(4) : void 0,
    vac: e.cityVac ? {
      office: +e.cityVac.office.toFixed(4),
      retail: +e.cityVac.retail.toFixed(4),
      multifamily: +e.cityVac.multifamily.toFixed(4),
      industrial: +e.cityVac.industrial.toFixed(4)
    } : void 0,
    rent: {
      office: +e.rentIdx.office.toFixed(2),
      retail: +e.rentIdx.retail.toFixed(2),
      multifamily: +e.rentIdx.multifamily.toFixed(2),
      industrial: +e.rentIdx.industrial.toFixed(2)
    },
    cap: {
      office: +e.capRate.office.toFixed(2),
      retail: +e.capRate.retail.toFixed(2),
      multifamily: +e.capRate.multifamily.toFixed(2),
      industrial: +e.capRate.industrial.toFixed(2)
    },
    abs: abs ? {
      office: Math.round(abs.office ?? 0),
      retail: Math.round(abs.retail ?? 0),
      multifamily: Math.round(abs.multifamily ?? 0),
      industrial: Math.round(abs.industrial ?? 0)
    } : void 0,
    comp: comp ? {
      office: Math.round(comp.office ?? 0),
      retail: Math.round(comp.retail ?? 0),
      multifamily: Math.round(comp.multifamily ?? 0),
      industrial: Math.round(comp.industrial ?? 0)
    } : void 0
  });
  if (e.history.length > 1260) e.history.shift();
}

// src/engine/mix.ts
var DOMINANT_AT = 0.85;
var MATERIAL = 0.04;
var clamp2 = (v, a, b) => Math.max(a, Math.min(b, v));
var DERIVED = /* @__PURE__ */ new Map();
function hash01(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1e4 / 1e4;
}
function deriveMix(rec) {
  const hit = DERIVED.get(rec.bbl);
  if (hit) return hit;
  const j = hash01(rec.bbl);
  const floors = Math.max(1, rec.floors || 1);
  const retail = clamp2(1 / floors * (1.05 + 0.3 * j), 0.06, 0.42);
  const rest = 1 - retail;
  const resLean = rec.unitsRes > 0 ? 0.58 + 0.3 * j : 0.18 + 0.34 * j;
  const multifamily = rest * resLean;
  const office = rest - multifamily;
  const m = normalize({ retail, multifamily, office });
  DERIVED.set(rec.bbl, m);
  return m;
}
function normalize(raw) {
  const out = {};
  let total = 0;
  for (const k of Object.keys(raw)) {
    const v = raw[k] ?? 0;
    if (v > MATERIAL) {
      out[k] = v;
      total += v;
    }
  }
  if (total <= 0) return { office: 1 };
  for (const k of Object.keys(out)) out[k] = +((out[k] ?? 0) / total).toFixed(4);
  return out;
}
function mixOf(rec) {
  if (rec.mix) return rec.mix;
  const cls = rec.class;
  if (cls === "land") return {};
  if (cls === "mixed") return deriveMix(rec);
  return { [cls]: 1 };
}
function normalizeParcels(table) {
  for (const bbl of Object.keys(table)) {
    const rec = table[bbl];
    if (rec.class !== "mixed") continue;
    const m = deriveMix(rec);
    rec.mix = m;
    rec.class = Object.keys(m).sort((a, b) => (m[b] ?? 0) - (m[a] ?? 0))[0];
  }
  return table;
}
function useSf(rec, use) {
  return (rec.bldgArea || 0) * (mixOf(rec)[use] ?? 0);
}
function uses(rec) {
  const m = mixOf(rec);
  return Object.keys(m).sort((a, b) => (m[b] ?? 0) - (m[a] ?? 0));
}
function dominantUse(rec) {
  return uses(rec)[0] ?? "office";
}
function isMixedUse(rec) {
  if (rec.class === "land") return false;
  const m = mixOf(rec);
  return Math.max(0, ...Object.values(m)) < DOMINANT_AT;
}
function blend(rec, table) {
  const m = mixOf(rec);
  let sum = 0, w = 0;
  for (const k of Object.keys(m)) {
    const share = m[k] ?? 0;
    const v = table[k];
    if (v === void 0) continue;
    sum += v * share;
    w += share;
  }
  return w > 0 ? sum / w : 0;
}
function blendBy(rec, f) {
  const m = mixOf(rec);
  let sum = 0, w = 0;
  for (const k of Object.keys(m)) {
    const share = m[k] ?? 0;
    sum += f(k) * share;
    w += share;
  }
  return w > 0 ? sum / w : 0;
}
function commercialShare(rec) {
  const m = mixOf(rec);
  return (m.office ?? 0) + (m.retail ?? 0) + (m.industrial ?? 0);
}
var USE_WORD = {
  office: "office",
  retail: "retail",
  multifamily: "apartments",
  industrial: "industrial"
};
function mixLabel(rec) {
  const m = mixOf(rec);
  return uses(rec).map((u) => `${Math.round((m[u] ?? 0) * 100)}% ${USE_WORD[u]}`).join(" \xB7 ");
}

// src/engine/value.ts
var clamp3 = (v, a, b) => Math.max(a, Math.min(b, v));
var FAR_CEILING = 40;
var DEMAND_GAMMA = 1.9;
function demandIdx(demandScore) {
  return Math.pow(Math.max(0, demandScore) / 100, 1 / DEMAND_GAMMA);
}
function demandLinear(demandScore) {
  return 100 * demandIdx(demandScore);
}
function demandBeta(demandScore) {
  return 0.25 + 0.9 * demandIdx(demandScore);
}
function landPsfNow(rec, econ) {
  return rec.landPsf * econ.landIdx * (1 + 0.22 * demandBeta(rec.demandScore) * econ.cycleDev);
}
function landValue(rec, econ) {
  return rec.lotArea * landPsfNow(rec, econ);
}
var CONDITION_RENT_MULT = {
  worn: 0.82,
  standard: 1,
  good: 1.2
};
function condMult(c) {
  return CONDITION_RENT_MULT[c] ?? 1;
}
function initialCondition(rec) {
  if (rec.yearBuilt >= 2e3) return "good";
  if (rec.yearBuilt >= 1965) return "standard";
  return "worn";
}
function locationRentMult(rec) {
  return 0.62 + 0.76 * demandIdx(rec.demandScore);
}
function marketRentPsfYr(rec, econ, condition) {
  if (rec.class === "land") return 0;
  return blend(rec, econ.rentIdx) * locationRentMult(rec) * condMult(condition);
}
function useRentPsfYr(rec, econ, condition, use) {
  return (econ.rentIdx[use] ?? 0) * locationRentMult(rec) * condMult(condition);
}
function resolveRec(parcels, s, bbl) {
  const rec = parcels[bbl];
  if (!rec) return null;
  const m = s.merged;
  if (m) {
    if (m[bbl]) return { ...rec, lotArea: 0, farMaxComm: 0, farMaxRes: 0 };
    let extra = 0;
    for (const [child, parent] of Object.entries(m)) {
      if (parent === bbl) extra += parcels[child]?.lotArea ?? 0;
    }
    if (extra > 0) {
      const grown = resolveBase(s, { ...rec, lotArea: rec.lotArea + extra });
      return grown;
    }
  }
  return resolveBase(s, rec);
}
function resolveBase(s, rec) {
  const bbl = rec.bbl;
  const b = s.built?.[bbl];
  const adj = s.landAdj?.[bbl];
  const dd = s.blockD?.[rec.block];
  const zx = s.zoneAdj?.[rec.district] ?? 1;
  const vr = s.variance?.[bbl] ?? 0;
  const marked = s.landmarks?.[bbl] !== void 0;
  if (!b && !adj && !dd && zx === 1 && !vr && !marked) return rec;
  const out = { ...rec };
  if (marked) {
    const builtFar = rec.lotArea > 0 ? rec.bldgArea / rec.lotArea : 0;
    out.farMaxComm = Math.min(rec.farMaxComm, builtFar);
    out.farMaxRes = Math.min(rec.farMaxRes, builtFar);
  } else if (zx !== 1 || vr) {
    out.farMaxComm = +Math.min(FAR_CEILING, rec.farMaxComm * zx + vr).toFixed(2);
    out.farMaxRes = +Math.min(FAR_CEILING, rec.farMaxRes * zx + vr).toFixed(2);
  }
  if (adj) out.landPsf = rec.landPsf * adj;
  if (dd) out.demandScore = clamp3(rec.demandScore + dd, 2, 100);
  if (b) {
    out.class = b.class;
    out.bldgArea = b.bldgArea;
    out.floors = b.floors;
    out.yearBuilt = b.yearBuilt;
    out.mix = b.mix;
    out.suites = b.suites;
  }
  return out;
}
function managedRentPsfYr(rec, econ, h, use) {
  let m = use ? useRentPsfYr(rec, econ, h.condition, use) : marketRentPsfYr(rec, econ, h.condition);
  const done = h.programsDone ?? {};
  if (done.lobby !== void 0) m *= 1.04;
  if (done.facade !== void 0) m *= 1.08;
  m *= 1 + 0.08 * (h.stance ?? 0);
  if (h.landmarked) m *= 1.07;
  return m;
}
var OCC_BASE = { office: 0.84, retail: 0.89, multifamily: 0.94, industrial: 0.87 };
function occHash(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1e4 / 1e4;
}
function leaseUpFactor(rec, econ, apt) {
  if (!rec.yearBuilt || econ.m === void 0) return 1;
  const nowYr = 2e3 + econ.m / 12;
  const age = nowYr - rec.yearBuilt;
  if (age < 0 || age > 4) return 1;
  const span = apt ? 1.6 : 3.2;
  if (age >= span) return 1;
  return clamp3(0.2 + 0.8 * Math.pow(age / span, 0.75), 0.2, 1);
}
function useOccupancy(rec, econ, use) {
  const apt = use === "multifamily";
  const swing = apt ? 0.04 : 0.09;
  const loc = 0.16 * (demandIdx(rec.demandScore) - 0.6);
  const u = occHash(rec.bbl + use);
  const idio = (apt ? 0.12 : 0.22) * (u - 0.62);
  const u2 = occHash("trouble:" + rec.bbl + use);
  const trouble = u2 < 0.12 ? (apt ? 0.14 : 0.28) * (1 - u2 / 0.12) : 0;
  const base = clamp3(OCC_BASE[use] + swing * econ.cycleDev + loc + idio - trouble, 0.35, 0.99);
  return base * leaseUpFactor(rec, econ, apt);
}
function occupancy(rec, econ) {
  if (rec.class === "land") return 0;
  return blendBy(rec, (u) => useOccupancy(rec, econ, u));
}
var OPEX_CONTROLLABLE = { office: 9.2, retail: 5.4, multifamily: 13, industrial: 2.3 };
var OPEX_FIXED = { office: 3.8, retail: 2.6, multifamily: 4.2, industrial: 1.2 };
var MGMT_FEE = 0.04;
function opexPsf(cls, econ, systemsDone) {
  return (OPEX_CONTROLLABLE[cls] * (systemsDone ? 0.82 : 1) + OPEX_FIXED[cls]) * econ.costIdx;
}
var OPEX_PSF = { office: 13, retail: 8, multifamily: 10, industrial: 3.5 };
var RECOVERY_RATE = {
  retail: 0.88,
  industrial: 0.92,
  office: 0.5,
  multifamily: 0
};
function taxBorneShare(rec) {
  if (rec.class === "land") return 1;
  return 1 - blendBy(rec, (u) => RECOVERY_RATE[u] * (u === "multifamily" ? 0 : 1));
}
function recoveryOf(t) {
  return t.recovery ?? (t.net ? "nnn" : "gross");
}
function recoveryFor(t, opexNowPsf, taxNowPsf) {
  const kind = recoveryOf(t);
  if (kind === "nnn") return { opex: t.sf * opexNowPsf, tax: t.sf * taxNowPsf };
  if (kind === "gross") return { opex: 0, tax: 0 };
  const stop = t.baseStopPsf ?? opexNowPsf + taxNowPsf;
  const overage = Math.max(0, opexNowPsf + taxNowPsf - stop);
  const total = overage * t.sf;
  const share = opexNowPsf + taxNowPsf > 0 ? opexNowPsf / (opexNowPsf + taxNowPsf) : 1;
  return { opex: total * share, tax: total * (1 - share) };
}
var TAX_RATE = 0.011;
function capRateFor(rec, econ, condition) {
  const base = rec.class === "land" ? 6 : blend(rec, econ.capRate) || 6;
  const locSpread = -((demandLinear(rec.demandScore) - 50) / 50) * 1.1;
  const qualSpread = condition === "good" ? -0.4 : condition === "worn" ? 0.7 : 0;
  return clamp3(base + locSpread + qualSpread, 3.2, 13);
}
function appraise(bbl, value) {
  let hsh = 2166136261;
  for (let i = 0; i < bbl.length; i++) {
    hsh ^= bbl.charCodeAt(i);
    hsh = Math.imul(hsh, 16777619);
  }
  const bias = ((hsh >>> 8) % 1e3 / 1e3 - 0.5) * 0.07;
  const mid = value * (1 + bias);
  return { lo: mid * 0.94, mid, hi: mid * 1.06 };
}
function noiYr(rec, econ, condition) {
  if (rec.class === "land" || !rec.bldgArea) {
    return -landValue(rec, econ) * 0.012;
  }
  let rent = 0, recovered = 0, opex = 0;
  for (const use of uses(rec)) {
    const sf = useSf(rec, use);
    if (sf <= 0) continue;
    const occ = useOccupancy(rec, econ, use);
    const op = sf * opexPsf(use, econ, false);
    rent += sf * useRentPsfYr(rec, econ, condition, use) * occ;
    opex += op;
    recovered += op * occ * RECOVERY_RATE[use];
  }
  const egi = rent + recovered;
  return egi - opex - egi * MGMT_FEE;
}
function noiAfterTaxYr(rec, econ, condition, price) {
  if (rec.class === "land" || !rec.bldgArea) return noiYr(rec, econ, condition);
  return noiYr(rec, econ, condition) - price * TAX_RATE * taxBorneShare(rec);
}
function grossTaxYr(rec, h) {
  const assessed = h.assessed ?? h.costBasis;
  if (rec.class === "land" || !rec.bldgArea) return 0;
  return assessed * TAX_RATE;
}
function propertyTaxYr(rec, h, econ) {
  const bill = grossTaxYr(rec, h);
  if (!bill) return 0;
  if (rec.class === "multifamily") return bill;
  const taxPsf = bill / Math.max(1, rec.bldgArea);
  const opexNowPsf = econ ? opexPsf(rec.class, econ, h.programsDone?.systems !== void 0) : taxPsf;
  let recovered = 0;
  for (const t of h.tenants) recovered += recoveryFor(t, opexNowPsf, taxPsf).tax;
  return Math.max(0, bill - recovered);
}
function holdingNOIYr(rec, econ, h, currentQ) {
  if (h.renovatingUntilM !== void 0 && currentQ < h.renovatingUntilM) {
    return -Math.max(0, rec.bldgArea) * 1.2;
  }
  if (rec.class === "land" || !rec.bldgArea) return h.groundLeased ? 0 : -landValue(rec, econ) * 0.012;
  const cls = rec.class;
  if (cls === "multifamily") {
    const occ = h.occ ?? occupancy(rec, econ);
    const egi2 = rec.bldgArea * marketRentPsfYr(rec, econ, h.condition) * occ;
    return egi2 * 0.93 - rec.bldgArea * OPEX_PSF[cls] * econ.costIdx - propertyTaxYr(rec, h);
  }
  const systemsDone = h.programsDone?.systems !== void 0;
  const opexNowPsf = opexPsf(cls, econ, systemsDone);
  const taxBill = grossTaxYr(rec, h);
  const taxNowPsf = taxBill / Math.max(1, rec.bldgArea);
  let baseRent = 0, leasedSf = 0, recoveredOpex = 0, recoveredTax = 0;
  for (const t of h.tenants) {
    leasedSf += t.sf;
    const r = recoveryFor(t, opexNowPsf, taxNowPsf);
    recoveredOpex += r.opex;
    recoveredTax += r.tax;
    if (t.freeUntilM !== void 0 && currentQ < t.freeUntilM) continue;
    baseRent += t.rentPsf * t.sf;
  }
  const egi = baseRent + recoveredOpex + recoveredTax;
  const opexBill = opexNowPsf * rec.bldgArea;
  const mgmt = egi * MGMT_FEE;
  return egi - opexBill - mgmt - taxBill;
}
function operatingStatement(rec, econ, h, month) {
  const cls = rec.class;
  const systemsDone = h.programsDone?.systems !== void 0;
  const opexNowPsf = opexPsf(cls, econ, systemsDone);
  const taxBill = grossTaxYr(rec, h);
  const taxNowPsf = taxBill / Math.max(1, rec.bldgArea);
  let baseRent = 0, leasedSf = 0, recOpex = 0, recTax = 0, free = 0;
  for (const t of h.tenants) {
    leasedSf += t.sf;
    const r = recoveryFor(t, opexNowPsf, taxNowPsf);
    recOpex += r.opex;
    recTax += r.tax;
    if (t.freeUntilM !== void 0 && month < t.freeUntilM) {
      free += t.rentPsf * t.sf;
      continue;
    }
    baseRent += t.rentPsf * t.sf;
  }
  const opexBill = opexNowPsf * rec.bldgArea;
  const egi = baseRent + recOpex + recTax;
  const mgmt = egi * MGMT_FEE;
  const noi = egi - opexBill - mgmt - taxBill;
  const billed = opexBill + taxBill;
  return {
    baseRent,
    freeRent: free,
    recoveredOpex: recOpex,
    recoveredTax: recTax,
    egi,
    opex: opexBill,
    mgmt,
    tax: taxBill,
    noi,
    leasedSf,
    vacantSf: Math.max(0, rec.bldgArea - leasedSf),
    // what you pay and never bill back, as a share of the whole expense stack
    leakage: billed > 0 ? Math.max(0, billed - recOpex - recTax) / billed : 0,
    opexPsf: opexNowPsf,
    taxPsf: taxNowPsf
  };
}
function assetValue(rec, econ, condition) {
  const land = landValue(rec, econ);
  if (rec.class === "land" || !rec.bldgArea) return land;
  const income = noiYr(rec, econ, condition) / (capRateFor(rec, econ, condition) / 100 + TAX_RATE * taxBorneShare(rec));
  return Math.max(income, land * 0.92);
}
function industryConcentration(h, econ) {
  let total = 0;
  const by = /* @__PURE__ */ new Map();
  for (const t of h.tenants) {
    const annual = t.rentPsf * t.sf;
    total += annual;
    by.set(t.sector, (by.get(t.sector) ?? 0) + annual);
  }
  if (total <= 0) return { share: 0, sector: null, stressed: 0 };
  let top = null, topV = 0, stressed = 0;
  for (const [k, v] of by) {
    if (v > topV) {
      topV = v;
      top = k;
    }
    if (econ) stressed += v * industryStress(econ, k);
  }
  return { share: topV / total, sector: top, stressed: stressed / total };
}
function concentration(h) {
  let top = 0, total = 0;
  for (const t of h.tenants) {
    const annual = t.rentPsf * t.sf;
    total += annual;
    if (annual > top) top = annual;
  }
  return total > 0 ? top / total : 0;
}
function residentialSpread(h) {
  const occ = h.occ ?? 0.95;
  return clamp3((0.94 - occ) * 2.2, -0.12, 0.85);
}
function rollQualitySpread(rec, h, month, econ) {
  if (rec.class === "land" || !rec.bldgArea) return 0.55;
  const commSf = rec.bldgArea * clamp3(commercialShare(rec), 0, 1);
  const resShare = clamp3(1 - commSf / rec.bldgArea, 0, 1);
  if (!h.tenants.length) {
    return resShare > 0.5 ? residentialSpread(h) : 0.55;
  }
  let sfTot = 0, wCredit = 0, wYears = 0, nnnSf = 0;
  for (const t of h.tenants) {
    sfTot += t.sf;
    wCredit += t.credit * t.sf;
    wYears += Math.max(0, (t.endM - month) / 12) * t.sf;
    if (recoveryOf(t) === "nnn") nnnSf += t.sf;
  }
  if (!sfTot) return resShare > 0.5 ? residentialSpread(h) : 0.55;
  const occ = sfTot / Math.max(1, commSf);
  const walt2 = wYears / sfTot;
  const credit = wCredit / sfTot;
  const waltSpread = clamp3(0.45 - 0.11 * walt2, -0.3, 0.55);
  const creditSpread = 0.18 - 0.2 * credit;
  const occSpread = clamp3((0.9 - occ) * 1.4, -0.1, 0.75);
  const structSpread = -0.1 * (nnnSf / sfTot);
  const conc = concentration(h);
  const covenantRelief = credit >= 1.6 && walt2 >= 8 ? 0.55 : credit >= 1.6 ? 0.25 : 0;
  const concSpread = clamp3(Math.max(0, conc - 0.35) / 0.65 * 0.75 * (1 - covenantRelief), 0, 0.75);
  const ind = industryConcentration(h, econ);
  const indSpread = clamp3(Math.max(0, ind.share - 0.45) / 0.55 * 0.4 + ind.stressed * 0.55, 0, 0.85);
  const comm = waltSpread + creditSpread + occSpread + structSpread + concSpread + indSpread;
  return resShare > 0.02 ? comm * (1 - resShare) + residentialSpread(h) * resShare : comm;
}
function remainingAbatement(h, month) {
  let owed = 0;
  for (const t of h.tenants) {
    if (t.freeUntilM === void 0 || t.freeUntilM <= month) continue;
    owed += t.rentPsf * t.sf * ((t.freeUntilM - month) / 12);
  }
  return owed;
}
function holdingValue(rec, econ, h, month) {
  if (rec.class === "land" || !rec.bldgArea) return landValue(rec, econ);
  const quality = month === void 0 ? 0 : rollQualitySpread(rec, h, month, econ);
  const cap = clamp3(capRateFor(rec, econ, h.condition) + quality, 2.8, 13) / 100;
  const inGut = month !== void 0 && h.renovatingUntilM !== void 0 && month < h.renovatingUntilM;
  const contractNoi = holdingNOIYr(rec, econ, h, inGut ? month : Number.POSITIVE_INFINITY);
  const inPlace = contractNoi / cap;
  const stabilized = noiYr(rec, econ, h.condition) / (cap + TAX_RATE);
  const blended = inPlace * 0.55 + stabilized * 0.45;
  const abate = month === void 0 ? 0 : remainingAbatement(h, month);
  return Math.max(landValue(rec, econ) * 0.92, blended - abate);
}
function monthlyNOI(rec, econ, h, currentQ) {
  return holdingNOIYr(rec, econ, h, currentQ) / 12;
}
var RENO_COST_PSF = { office: 210, retail: 150, multifamily: 165, industrial: 90 };
var RENO_MONTHS = 6;
function renovationCost(rec, econ) {
  if (rec.class === "land" || !rec.bldgArea) return 0;
  return Math.round(rec.bldgArea * RENO_COST_PSF[rec.class] * econ.costIdx);
}
function netWorth(s, parcels) {
  let nw = s.cash;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    nw += holdingValue(rec, s.econ, h, s.month) - (h.loan?.balance ?? 0);
  }
  for (const d of Object.values(s.developments ?? {})) {
    nw += d.costTotal - d.loanBalance;
  }
  nw -= s.loc?.balance ?? 0;
  for (const h of Object.values(s.holdings)) {
    for (const t of h.tenants) nw -= t.deposit ?? 0;
  }
  return nw;
}

// src/engine/comps.ts
var MAX_COMPS = 240;
function recordComp(s, rec, price, buyer, seller, distress, condition) {
  if (!rec || price <= 0) return;
  if (!s.comps) s.comps = [];
  const built = rec.class !== "land" && rec.bldgArea > 0;
  const cond = condition ?? initialCondition(rec);
  const noi = built ? noiAfterTaxYr(rec, s.econ, cond, price) : 0;
  s.comps.push({
    m: s.month,
    bbl: rec.bbl,
    address: rec.address,
    cls: rec.class,
    price: Math.round(price),
    sf: built ? rec.bldgArea : 0,
    psf: built ? price / Math.max(1, rec.bldgArea) : price / Math.max(1, rec.lotArea),
    capRate: built && price > 0 ? +(noi / price * 100).toFixed(2) : 0,
    buyer,
    seller,
    distress: distress || void 0
  });
  if (s.comps.length > MAX_COMPS) s.comps.splice(0, s.comps.length - MAX_COMPS);
}
function compStats(s, cls, months = 36) {
  const since = s.month - months;
  const land = cls === "land";
  const rows = (s.comps ?? []).filter((c) => c.m >= since && c.cls === cls && (land ? c.sf === 0 : c.sf > 0));
  if (rows.length < 3) return null;
  const caps = rows.map((c) => c.capRate).filter((x) => x > 0).sort((a, b) => a - b);
  const psfs = rows.map((c) => c.psf).sort((a, b) => a - b);
  const mid = (a) => a.length ? a[Math.floor(a.length / 2)] : 0;
  return {
    n: rows.length,
    medCap: mid(caps),
    medPsf: mid(psfs),
    volume: rows.reduce((a, c) => a + c.price, 0),
    distressShare: rows.filter((c) => c.distress).length / rows.length
  };
}
function compFlows(s, months = 36) {
  const named = /* @__PURE__ */ new Set(["You", ...(s.rivals ?? []).map((r) => r.name)]);
  const since = s.month - months;
  const by = /* @__PURE__ */ new Map();
  const at = (k) => {
    let e = by.get(k);
    if (!e) {
      e = { bought: 0, sold: 0, boughtN: 0, soldN: 0 };
      by.set(k, e);
    }
    return e;
  };
  for (const c of s.comps ?? []) {
    if (c.m < since) continue;
    if (named.has(c.buyer)) {
      const e = at(c.buyer);
      e.bought += c.price;
      e.boughtN++;
    }
    if (named.has(c.seller)) {
      const e = at(c.seller);
      e.sold += c.price;
      e.soldN++;
    }
  }
  return [...by.entries()].map(([name, v]) => ({ name, ...v, net: v.bought - v.sold })).sort((a, b) => b.bought + b.sold - (a.bought + a.sold));
}
function portfolioIndustries(s) {
  const by = /* @__PURE__ */ new Map();
  let total = 0;
  for (const h of Object.values(s.holdings)) {
    for (const t of h.tenants) {
      const annual = t.rentPsf * t.sf;
      total += annual;
      const e = by.get(t.sector) ?? { income: 0, sf: 0, tenants: 0 };
      e.income += annual;
      e.sf += t.sf;
      e.tenants++;
      by.set(t.sector, e);
    }
  }
  const rows = [...by.entries()].map(([sector, v]) => ({
    sector,
    ...v,
    share: total > 0 ? v.income / total : 0,
    stress: industryStress(s.econ, sector),
    mom: s.econ.industryMom?.[sector] ?? 0,
    phase: s.econ.industryPhase?.[sector] ?? "steady"
  })).sort((a, b) => b.income - a.income);
  const atRisk = rows.reduce((a, r) => a + r.share * r.stress, 0);
  return { rows, total, top: rows[0] ?? null, atRisk };
}

// src/engine/zoning.ts
var clamp4 = (v, a, b) => Math.max(a, Math.min(b, v));
var FAR_FLOOR = 0.72;
var FAR_CEIL = 2.6;
function tickZoning(s, parcels, bbls) {
  if (!s.zoneAdj) s.zoneAdj = {};
  if (rng(s) > 0.019) return;
  const byDist = /* @__PURE__ */ new Map();
  for (const bbl of bbls) {
    const rec = parcels[bbl];
    if (!rec || !rec.lotArea) continue;
    const live = resolveRec(parcels, s, bbl);
    if (!live) continue;
    const d = rec.district || "\u2014";
    const e = byDist.get(d) ?? { built: 0, envelope: 0, demand: 0, n: 0 };
    e.built += live.bldgArea;
    e.envelope += live.lotArea * Math.max(live.farMaxComm, live.farMaxRes, 2);
    e.demand += live.demandScore;
    e.n++;
    byDist.set(d, e);
  }
  const rows = [...byDist.entries()].filter(([, v2]) => v2.n >= 20);
  if (!rows.length) return;
  const pick = rows[Math.floor(rng(s) * rows.length)];
  const [dist, v] = pick;
  const usedUp = v.envelope > 0 ? v.built / v.envelope : 0;
  const demand = v.demand / v.n;
  const cur = s.zoneAdj[dist] ?? 1;
  const up = clamp4(0.42 + usedUp * 0.7 + (demand - 50) / 120, 0.12, 0.95);
  const isUp = rng(s) < up;
  const step = isUp ? rrange(s, 1.12, 1.45) : rrange(s, 0.86, 0.96);
  const next = clamp4(cur * step, FAR_FLOOR, FAR_CEIL);
  if (Math.abs(next - cur) < 0.02) return;
  s.zoneAdj[dist] = +next.toFixed(3);
  for (const bbl of bbls) {
    if (parcels[bbl]?.district !== dist) continue;
    s.landAdj[bbl] = Math.min(4, (s.landAdj[bbl] ?? 1) * (isUp ? 1 + (step - 1) * 0.45 : 1 - (1 - step) * 0.4));
  }
  const yours = Object.keys(s.holdings).filter((b) => parcels[b]?.district === dist).length;
  s.news.unshift({
    q: s.month,
    kind: isUp ? "event" : "warn",
    text: isUp ? `${dist} has been upzoned \u2014 the envelope goes to ${(next * 100).toFixed(0)}% of what it was at the start. Every lot there is worth more this morning than it was last night${yours ? `, and you own ${yours} of them` : ""}.` : `${dist} has been downzoned to ${(next * 100).toFixed(0)}% of its original envelope. The neighbourhood fought it and won${yours ? `, and you are holding ${yours} lots there` : ""}.`
  });
}
function varianceQuote(s, parcels, bbl) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.lotArea) return null;
  if (s.landmarks?.[bbl] !== void 0) return null;
  const land = landValue(rec, s.econ);
  const cost = Math.round(Math.max(12e4, land * 0.035) * s.econ.costIdx);
  const months = Math.round(rrange(s, 9, 18));
  if ((s.variance?.[bbl] ?? 0) > 0) return null;
  const grant = +(Math.max(rec.farMaxComm, rec.farMaxRes, 2) * 0.34).toFixed(2);
  const dense = clamp4(demandLinear(rec.demandScore) / 130, 0.1, 0.75);
  const odds = clamp4(0.3 + dense - (s.econ.phase === "recession" ? 0.08 : 0), 0.08, 0.82);
  return { cost, months, grant, odds };
}
function fileVariance(s, parcels, bbl) {
  if (!s.holdings[bbl]) return { s, err: "You have to own it to ask for anything." };
  if (s.varianceApp) return { s, err: "You already have an application in front of the board. One at a time." };
  if (s.landmarks?.[bbl] !== void 0) return { s, err: "It is landmarked. The envelope is the envelope." };
  if ((s.variance?.[bbl] ?? 0) > 0) return { s, err: "The board has already granted relief on this site. They will not do it twice." };
  const q = varianceQuote(s, parcels, bbl);
  if (!q) return { s, err: "Nothing to apply for here." };
  if (s.cash < q.cost) return { s, err: `The application runs $${(q.cost / 1e6).toFixed(2)}M in fees \u2014 you're short.` };
  const next = JSON.parse(JSON.stringify(s));
  next.cash -= q.cost;
  logBooks(next, "dev", q.cost);
  next.varianceApp = { bbl, filedM: next.month, decideM: next.month + q.months, cost: q.cost, grant: q.grant, odds: q.odds };
  const rec = resolveRec(parcels, next, bbl);
  next.news.unshift({
    q: next.month,
    kind: "info",
    text: `Application filed at ${rec?.address ?? bbl}: ${q.grant.toFixed(1)} FAR over the district maximum. The board sits ${monthLabel(next.month + q.months)} and they say yes about ${(q.odds * 100).toFixed(0)}% of the time.`
  });
  return { s: next, msg: "Filed." };
}
function decideVariance(s, parcels) {
  const app = s.varianceApp;
  if (!app || s.month < app.decideM) return;
  const rec = resolveRec(parcels, s, app.bbl);
  delete s.varianceApp;
  if (!s.holdings[app.bbl]) return;
  const granted = rng(s) < app.odds;
  if (!s.varianceLog) s.varianceLog = {};
  s.varianceLog[app.bbl] = { m: s.month, granted, far: app.grant, cost: app.cost };
  if (granted) {
    if (!s.variance) s.variance = {};
    s.variance[app.bbl] = +((s.variance[app.bbl] ?? 0) + app.grant).toFixed(2);
    s.landAdj[app.bbl] = Math.min(4, (s.landAdj[app.bbl] ?? 1) * 1.22);
    s.news.unshift({
      q: s.month,
      kind: "deal",
      text: `The board approved the variance at ${rec?.address ?? app.bbl}. ${app.grant.toFixed(1)} FAR of extra envelope, and the dirt underneath it just repriced.`
    });
  } else {
    s.news.unshift({
      q: s.month,
      kind: "warn",
      text: `The board refused the variance at ${rec?.address ?? app.bbl}. The fees are spent and the envelope is what it always was.`
    });
  }
}
function tickLandmarks(s, parcels, bbls) {
  if (rng(s) > 6e-3) return;
  const cands = bbls.filter((b) => {
    if (s.landmarks?.[b] !== void 0 || s.developments[b]) return false;
    const rec2 = resolveRec(parcels, s, b);
    return !!rec2 && rec2.class !== "land" && rec2.bldgArea > 0 && rec2.yearBuilt > 0 && rec2.yearBuilt < 1940 && demandLinear(rec2.demandScore) > 45;
  });
  if (!cands.length) return;
  const bbl = cands[Math.floor(rng(s) * cands.length)];
  const rec = resolveRec(parcels, s, bbl);
  if (!s.landmarks) s.landmarks = {};
  s.landmarks[bbl] = s.month;
  const mine = !!s.holdings[bbl];
  if (mine) s.holdings[bbl].landmarked = true;
  s.news.unshift({
    q: s.month,
    kind: mine ? "warn" : "info",
    text: `${rec.address} has been landmarked${mine ? " \u2014 one of yours" : ""}. Nobody knocks it down now, and nobody builds anything bigger there. It will let a little better than the market for the rest of its life, which is the whole of what you get for the site.`
  });
}
function tickPlanning(s, parcels, bbls) {
  decideVariance(s, parcels);
  tickZoning(s, parcels, bbls);
  tickLandmarks(s, parcels, bbls);
}

// src/engine/sponsor.ts
var MEMORY_M = 120;
function sponsorStanding(s) {
  let mark = 0;
  for (const e of s.sponsor?.events ?? []) {
    const age = s.month - e.m;
    if (age < 0 || age >= MEMORY_M) continue;
    const w = 1 - age / MEMORY_M;
    mark += w * (e.kind === "deficiency" ? 1.3 : e.kind === "seized" ? 1.15 : 0.75);
  }
  return {
    mark,
    spreadAdd: Math.min(2.6, 0.45 * mark),
    advanceCut: Math.min(0.28, 0.075 * mark),
    // past this the life companies and the agencies stop returning calls, and
    // you are financing with bridge money at bridge prices
    institutional: mark < 1.6,
    label: mark < 0.25 ? "clean" : mark < 0.8 ? "a mark on the record" : mark < 1.6 ? "watch-listed" : mark < 3 ? "shut out of institutional money" : "untouchable"
  };
}
function distressPrice(s) {
  const tight = Math.max(0, 1 - (s.econ.creditIdx ?? 1));
  const down = Math.max(0, -(s.econ.cycleDev ?? 0));
  return Math.max(0.62, 0.9 - 0.22 * tight - 0.08 * down);
}
function markSponsor(s, kind, address, amount = 0) {
  if (!s.sponsor) s.sponsor = { events: [] };
  const before = sponsorStanding(s);
  s.sponsor.events.push({ m: s.month, kind, address, amount: Math.round(amount) });
  const after = sponsorStanding(s);
  if (before.institutional && !after.institutional) {
    s.news.unshift({
      q: s.month,
      kind: "warn",
      text: "The institutional desks have stopped returning your calls. Agency and insurance money is closed to you until this ages off the record \u2014 bridge lenders will still talk, at bridge prices."
    });
  }
}

// src/engine/credit.ts
var LOC_LTV = 0.6;
var LOC_SPREAD = 4;
function locRate(s) {
  return +(s.econ.indexRate + LOC_SPREAD).toFixed(2);
}
function locLimit(s, parcels) {
  const nw = netWorth(s, parcels);
  const ci = s.econ.creditIdx ?? 1;
  const st = sponsorStanding(s);
  const advance = LOC_LTV * Math.max(0.35, Math.min(1.15, ci)) * (1 - Math.min(0.6, 1.6 * st.advanceCut));
  return Math.max(0, Math.round(nw * advance));
}
function locAvailable(s, parcels) {
  return Math.max(0, locLimit(s, parcels) - (s.loc?.balance ?? 0));
}
function drawLoc(s, parcels, amount) {
  const next = JSON.parse(JSON.stringify(s));
  if (!next.loc) next.loc = { balance: 0, drawnTotal: 0, interestPaid: 0 };
  const avail = locAvailable(next, parcels);
  const amt = Math.round(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { s, err: "Name an amount." };
  if (amt > avail) {
    const st = sponsorStanding(next);
    return {
      s,
      err: `The line only has $${(avail / 1e6).toFixed(2)}M left.` + (st.mark > 0.3 ? ` The bank cut your advance rate \u2014 ${st.label}.` : " That's the bank's advance rate against your net worth.")
    };
  }
  next.loc.balance += amt;
  next.loc.drawnTotal += amt;
  next.cash += amt;
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Drew $${(amt / 1e6).toFixed(2)}M on the line at ${locRate(next).toFixed(2)}%. Balance $${(next.loc.balance / 1e6).toFixed(2)}M.`
  });
  return { s: next };
}
function repayLoc(s, amount) {
  const next = JSON.parse(JSON.stringify(s));
  if (!next.loc?.balance) return { s, err: "Nothing drawn." };
  const amt = Math.min(Math.round(amount), next.loc.balance, Math.max(0, next.cash));
  if (amt <= 0) return { s, err: "No cash to pay it down with." };
  next.loc.balance -= amt;
  next.cash -= amt;
  next.news.unshift({
    q: next.month,
    kind: "info",
    text: `Paid $${(amt / 1e6).toFixed(2)}M down on the line. Balance $${(next.loc.balance / 1e6).toFixed(2)}M.`
  });
  return { s: next };
}
function tickLoc(s, parcels) {
  if (!s.loc) s.loc = { balance: 0, drawnTotal: 0, interestPaid: 0 };
  const rate = locRate(s);
  if (s.loc.balance > 0) {
    const interest = Math.round(s.loc.balance * rate / 100 / 12);
    s.cash -= interest;
    s.loc.interestPaid += interest;
    logBooks(s, "debtSvc", interest);
  }
  if (s.cash < 0) {
    const need = Math.ceil(-s.cash);
    const avail = locAvailable(s, parcels);
    const draw = Math.min(need, avail);
    if (draw > 0) {
      s.loc.balance += draw;
      s.loc.drawnTotal += draw;
      s.cash += draw;
      s.news.unshift({
        q: s.month,
        kind: "warn",
        text: `Short $${(need / 1e6).toFixed(2)}M \u2014 the line covered $${(draw / 1e6).toFixed(2)}M at ${rate.toFixed(2)}%.`
      });
    }
  } else if (s.loc.balance > 0 && s.cash > 25e4) {
    const sweep = Math.min(s.loc.balance, Math.floor(s.cash - 25e4));
    if (sweep > 0) {
      s.loc.balance -= sweep;
      s.cash -= sweep;
    }
  }
  const over = s.loc.balance - locLimit(s, parcels);
  if (over > 0) {
    const pay = Math.min(over, Math.max(0, s.cash));
    if (pay > 0) {
      s.loc.balance -= pay;
      s.cash -= pay;
    }
    const stillOver = s.loc.balance - locLimit(s, parcels);
    if (stillOver > 1e3) {
      s.locOverMs = (s.locOverMs ?? 0) + 1;
      s.news.unshift({
        q: s.month,
        kind: "warn",
        text: s.locOverMs >= 6 ? `The line has been over-advanced for ${s.locOverMs} months. The bank wants $${(stillOver / 1e6).toFixed(2)}M back and has stopped asking politely.` : `The line is over-advanced \u2014 the bank wants $${(stillOver / 1e6).toFixed(2)}M back.`
      });
      if (s.locOverMs >= 6) s.cash -= Math.round(stillOver * 0.25);
    } else s.locOverMs = 0;
  }
}

// src/engine/leasing.ts
var clampL = (v, a, b) => Math.max(a, Math.min(b, v));
function rollRecovery(s, cls) {
  const r = rng(s);
  switch (cls) {
    case "retail":
      return r < 0.86 ? "nnn" : r < 0.95 ? "base" : "gross";
    case "industrial":
      return r < 0.92 ? "nnn" : "base";
    case "office":
      return r < 0.3 ? "nnn" : r < 0.88 ? "base" : "gross";
    default:
      return r < 0.45 ? "nnn" : r < 0.86 ? "base" : "gross";
  }
}
function stopPsfNow(rec, econ, h, use) {
  const tax = (h.assessed ?? h.costBasis) * TAX_RATE / Math.max(1, rec.bldgArea);
  const sys = h.programsDone?.systems !== void 0;
  const op = use ? opexPsf(use, econ, sys) : blendBy(rec, (u) => opexPsf(u, econ, sys));
  return op + tax;
}
var money = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n).toLocaleString()}`;
var POOL = {
  finance: ["Meridian Capital", "Harborline Securities", "Crown & Weir", "Bellamy Fund Group", "Quayside Partners"],
  law: ["Ashe & Porter LLP", "Calder Marsh", "Winslow Legal", "Tern & Rigging", "Foundry Law Group"],
  tech: ["Brightwater Systems", "Ledgerworks", "Spindrift Labs", "Cordage Software", "Beacon Analytics"],
  media: ["The Alden Ledger", "Harborcast Studios", "Gullwing Press", "Northside Signal"],
  insurance: ["Maritime Mutual", "Anchor Assurance", "Seawall Underwriters", "Garland Indemnity"],
  logistics: ["Freightline Co.", "Slipway Cargo", "Gantry Freight", "Blue Hull Shipping"],
  apparel: ["Tidewater Trading Co.", "Rowan Thread Works", "Salt & Selvedge", "Customs House Outfitters"],
  food: ["The Chandler Room", "Bell Slip Provisions", "Kiln Street Roasters", "Founders Market Hall"],
  medical: ["Harbor Medical Group", "Northside Clinic", "Beacon Dental", "Alden Diagnostics"],
  design: ["Marsh & Vane Architects", "Cooper Lane Studio", "Pier Four Design", "Whitlow Drafting"]
};
var SECTORS_BY_CLASS = {
  office: ["finance", "law", "tech", "media", "insurance", "design"],
  retail: ["apparel", "food", "medical"],
  industrial: ["logistics", "food", "apparel"]
};
function pickSector(s, cls) {
  const arr = SECTORS_BY_CLASS[cls] ?? SECTORS_BY_CLASS.office;
  const w = arr.map((k) => industryPull(s.econ, k));
  let roll = rng(s) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < arr.length; i++) {
    roll -= w[i];
    if (roll <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}
function pickName(s, sector) {
  const arr = POOL[sector];
  return arr[Math.floor(rng(s) * arr.length) % arr.length];
}
function rollCredit(s, demand) {
  const r = rng(s) + demand / 250;
  return r > 0.95 ? 2 : r > 0.55 ? 1 : 0;
}
function isCommercial(rec) {
  return rec.class !== "land" && commercialShare(rec) > 0.02;
}
function commercialSf(rec) {
  return (rec.bldgArea || 0) * commercialShare(rec);
}
function leasableUses(rec) {
  return uses(rec).filter((u) => u !== "multifamily");
}
var COMMERCIAL_SUITE_MIN = 2e3;
function useSuiteSf(rec, use) {
  const chosen = rec.suites?.[use];
  if (chosen && chosen > 0) return chosen;
  const a = Math.max(1, useSf(rec, use) || rec.bldgArea);
  switch (use) {
    case "multifamily":
      return 900;
    // an apartment
    case "industrial":
      return Math.max(12e3, Math.min(9e4, a / 2.2));
    // TWO THOUSAND FEET IS THE FLOOR FOR A COMMERCIAL TENANCY.
    //
    // Shops were demising to 1,400 and offices to 2,500, which produced towers
    // cut into forty tiny suites and a rent roll that read like a market stall.
    // Below about two thousand feet a commercial tenancy is not an asset —
    // it is a serviced office or a kiosk, and neither is what this game is
    // about. Flats keep their own floor, because a flat is a flat.
    case "retail":
      return Math.max(COMMERCIAL_SUITE_MIN, Math.min(14e3, a / 6));
    default:
      return Math.max(COMMERCIAL_SUITE_MIN, Math.min(28e3, a / 12));
  }
}
function suiteSf(rec) {
  return useSuiteSf(rec, leasableUses(rec)[0] ?? dominantUse(rec));
}
function unitCount(rec) {
  if (!rec.bldgArea) return 0;
  let n = 0;
  for (const u of uses(rec)) {
    const sf = useSf(rec, u);
    if (sf <= 0) continue;
    n += Math.max(1, Math.round(sf / useSuiteSf(rec, u)));
  }
  return Math.max(1, n);
}
function unitsOf(rec, sf) {
  return Math.max(1, Math.round(sf / suiteSf(rec)));
}
function unitStatusByUse(rec, h, month) {
  const out = [];
  const notReadyTotal = notReadySf(h, month);
  for (const use of uses(rec)) {
    const sf = useSf(rec, use);
    if (sf <= 0) continue;
    const sfPer = useSuiteSf(rec, use);
    const total = Math.max(1, Math.round(sf / sfPer));
    if (use === "multifamily") {
      const leased2 = Math.min(total, Math.round((h.occ ?? 0) * total));
      out.push({ use, total, leased: leased2, vacant: total - leased2, notReady: 0, sfPer });
      continue;
    }
    const leasedSf = h.tenants.filter((t) => (t.use ?? dominantUse(rec)) === use).reduce((n, t) => n + t.sf, 0);
    const leased = Math.min(total, Math.max(leasedSf > 0 ? 1 : 0, Math.round(leasedSf / sfPer)));
    const nr = Math.min(Math.max(0, total - leased), Math.round(notReadyTotal * (sf / Math.max(1, commercialSf(rec))) / sfPer));
    out.push({ use, total, leased, vacant: Math.max(0, total - leased - nr), notReady: nr, sfPer });
  }
  return out;
}
function unitStatus(rec, h, month) {
  const byUse = unitStatusByUse(rec, h, month);
  const sum = (f) => byUse.reduce((a, r) => a + f(r), 0);
  const total = sum((r) => r.total);
  return {
    total,
    leased: sum((r) => r.leased),
    vacant: sum((r) => r.vacant),
    notReady: sum((r) => r.notReady),
    sfPer: suiteSf(rec),
    byUse
  };
}
var PART_SUITE_MIN = COMMERCIAL_SUITE_MIN;
function toSuites(rec, want, cap, use) {
  const sfPer = use ? useSuiteSf(rec, use) : suiteSf(rec);
  const floor = use === "multifamily" ? 450 : PART_SUITE_MIN;
  const maxUnits = Math.floor(cap / sfPer + 0.02);
  if (maxUnits < 1) return cap >= floor ? Math.round(cap) : 0;
  const n = Math.max(1, Math.min(maxUnits, Math.round(want / sfPer)));
  const taken = n * sfPer;
  const left = cap - taken;
  const out = Math.min(Math.floor(cap), Math.round(left > 0 && left < Math.min(floor, sfPer * 0.35) ? cap : taken));
  return out >= floor ? out : 0;
}
function genRentRoll(s, rec, holding) {
  if (!rec.bldgArea) return;
  const m = mixOf(rec);
  if ((m.multifamily ?? 0) > 0) {
    holding.occ = Math.min(0.99, Math.max(0.5, useOccupancy(rec, s.econ, "multifamily") + rrange(s, -0.05, 0.04)));
  }
  if (!isCommercial(rec)) return;
  const anchors = [
    s.month + Math.round(rrange(s, 9, 36)),
    s.month + Math.round(rrange(s, 39, 90))
  ];
  for (const use of leasableUses(rec)) {
    const legSf = useSf(rec, use);
    if (legSf < 400) continue;
    const targetOcc = Math.min(0.98, useOccupancy(rec, s.econ, use) + rrange(s, -0.14, 0.05));
    const market = useRentPsfYr(rec, s.econ, holding.condition, use);
    let leased = 0;
    let guard = 0;
    while (leased < legSf * targetOcc && guard++ < 40) {
      const free = legSf * targetOcc - leased;
      const want = useSuiteSf(rec, use) * Math.max(1, Math.round(rrange(s, 1, use === "industrial" ? 1.6 : 2.8)));
      const sf = toSuites(rec, want, free, use);
      if (!sf) break;
      const sector = pickSector(s, use);
      const endM = rng(s) < 0.6 ? anchors[Math.floor(rng(s) * anchors.length) % anchors.length] + Math.round(rrange(s, -3, 3)) : s.month + Math.round(rrange(s, 6, 96));
      holding.tenants.push({
        name: pickName(s, sector),
        use,
        sector,
        credit: rollCredit(s, demandLinear(rec.demandScore)),
        sf,
        rentPsf: +(market * rrange(s, 0.82, 1.04)).toFixed(2),
        net: use === "office" ? rng(s) < 0.75 : rng(s) < 0.4,
        recovery: rollRecovery(s, use),
        // Signed in the past, so the stop is frozen at the cheaper expense level
        // of that year — the older the lease, the bigger the gap the owner eats.
        baseStopPsf: +(stopPsfNow(rec, s.econ, holding, use) * rrange(s, 0.72, 0.98)).toFixed(2),
        startM: s.month - Math.round(rrange(s, 0, 48)),
        endM: Math.max(s.month + 1, endM),
        // The in-place deposits come across on the settlement statement — cash
        // in, liability up, no effect on net worth. What it does mean is that
        // buying a fully let building hands you real money you will have to
        // give back, which is exactly how the closing works.
        deposit: depositFor(s, market, sf, rollCredit(s, demandLinear(rec.demandScore)))
      });
      s.cash += holding.tenants[holding.tenants.length - 1].deposit ?? 0;
      leased += sf;
    }
  }
}
function vacantSf(rec, h) {
  return Math.max(0, commercialSf(rec) - h.tenants.reduce((sum, t) => sum + t.sf, 0));
}
function useVacantSf(rec, h, use, month) {
  const taken = h.tenants.filter((t) => (t.use ?? dominantUse(rec)) === use).reduce((n, t) => n + t.sf, 0);
  const turning = month === void 0 ? 0 : notReadySf(h, month, use);
  return Math.max(0, useSf(rec, use) - taken - turning);
}
function notReadySf(h, month, use) {
  return (h.makeReady ?? []).reduce(
    (sum, m) => sum + (m.readyM > month && (use === void 0 || (m.use ?? use) === use) ? m.sf : 0),
    0
  );
}
var MAKE_READY_PSF = 6;
function genAnchorTenant(s, rec, h, sfWanted, discount = 1, forUse) {
  if (!isCommercial(rec)) return;
  const use = (forUse && leasableUses(rec).includes(forUse) ? forUse : leasableUses(rec)[0]) ?? "office";
  const sfAnchor = Math.min(sfWanted, useVacantSf(rec, h, use, s.month));
  if (sfAnchor < 1e3) return;
  const sector = pickSector(s, use);
  const market = useRentPsfYr(rec, s.econ, h.condition, use) * discount;
  h.tenants.push({
    name: pickName(s, sector),
    use,
    sector,
    credit: rng(s) > 0.4 ? 2 : 1,
    // anchors are credit tenants
    sf: Math.round(sfAnchor),
    rentPsf: +(market * rrange(s, 0.9, 0.97)).toFixed(2),
    net: true,
    recovery: "nnn",
    startM: s.month,
    endM: s.month + Math.round(rrange(s, 120, 180))
  });
}
function walt(h, q) {
  const tot = h.tenants.reduce((sum, t) => sum + t.sf, 0);
  if (!tot) return 0;
  return h.tenants.reduce((sum, t) => sum + (t.endM - q) / 12 * t.sf, 0) / tot;
}
var TI_ASK = {
  office: [15, 40],
  retail: [5, 20],
  industrial: [2, 8],
  multifamily: [0, 3]
};
function concessionPressure(e, use) {
  const k = use === "office" || use === "retail" || use === "multifamily" || use === "industrial" ? use : "office";
  const gap = (e.cityVac?.[k] ?? NATURAL_VAC[k]) - NATURAL_VAC[k];
  const phase = e.phase === "recession" ? 0.22 : e.phase === "recovery" ? 0.08 : e.phase === "peak" ? -0.04 : -0.1;
  return Math.max(0.22, Math.min(2.1, 1 + gap * 11 + phase));
}
function tickLeasing(s, parcels) {
  const q = s.month;
  s.lois = s.lois.filter((l) => l.expiresM > q && s.holdings[l.bbl]);
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    const resShare = mixOf(rec).multifamily ?? 0;
    if (resShare > 0) {
      const target = useOccupancy(rec, s.econ, "multifamily");
      h.occ = Math.min(0.99, Math.max(0.4, (h.occ ?? target) + (target - (h.occ ?? target)) * 0.1 + rrange(s, -6e-3, 6e-3)));
    }
    if (!isCommercial(rec)) continue;
    const renovating = h.renovatingUntilM !== void 0 && q < h.renovatingUntilM;
    if (!renovating) {
      h.lastCapM = h.lastCapM ?? h.boughtM;
      const since = q - h.lastCapM;
      const clock = rec.class === "office" ? 240 : rec.class === "retail" ? 270 : 320;
      if (since > clock && rng(s) < 0.02) {
        const next = h.condition === "good" ? "standard" : h.condition === "standard" ? "worn" : null;
        if (next) {
          h.condition = next;
          h.lastCapM = q;
          s.news.unshift({
            q,
            kind: "warn",
            text: `${rec.address} has slipped to ${next} condition \u2014 the systems are dated and the brokers have noticed. Rents will follow.`
          });
        }
      }
    }
    const movedOut = h.tenants.filter((t) => t.endM <= q);
    h.tenants = h.tenants.filter((t) => t.endM > q);
    if (movedOut.length) {
      const outSf = movedOut.reduce((sum, t) => sum + t.sf, 0);
      const turnCost = Math.round(outSf * MAKE_READY_PSF * s.econ.costIdx);
      s.cash -= turnCost;
      logBooks(s, "capex", turnCost);
      const returned = movedOut.reduce((sum, t) => sum + (t.deposit ?? 0), 0);
      if (returned > 0) s.cash -= returned;
      const soft = s.econ.phase === "recession" ? 1.7 : s.econ.phase === "recovery" ? 1.3 : s.econ.phase === "peak" ? 0.95 : 0.8;
      const lagFor = (u) => u === "office" ? 5.5 : u === "industrial" ? 2.5 : 3.5;
      const entries = movedOut.map((mo) => ({
        sf: mo.sf,
        use: mo.use,
        readyM: q + Math.max(1, Math.round(lagFor(mo.use ?? dominantUse(rec)) * soft * rrange(s, 0.7, 1.4)))
      }));
      const down = Math.max(...entries.map((e) => e.readyM - q));
      h.makeReady = [...h.makeReady ?? [], ...entries];
      s.news.unshift({
        q,
        kind: "info",
        text: `${(outSf / 1e3).toFixed(1)}k sf back at ${rec.address} \u2014 $${(turnCost / 1e3).toFixed(0)}K make-ready, ${down} months before it can be shown.`
      });
    }
    if (h.makeReady) {
      h.makeReady = h.makeReady.filter((m) => m.readyM > q);
      if (!h.makeReady.length) delete h.makeReady;
    }
    if (h.broker) {
      const vacNow = vacantSf(rec, h);
      if (vacNow > 500) {
        const fee = Math.max(400, Math.round(vacNow * 0.025));
        s.cash -= fee;
        logBooks(s, "leasing", fee);
      } else delete h.broker;
    }
    for (let i = h.tenants.length - 1; i >= 0; i--) {
      const t = h.tenants[i];
      if (q - t.startM < 6) continue;
      const cycle = s.econ.phase === "recession" ? 3.4 : s.econ.phase === "recovery" ? 1.7 : s.econ.phase === "peak" ? 0.9 : 0.55;
      const grade = t.credit === 2 ? 0.14 : t.credit === 1 ? 0.55 : 1.6;
      const sectorStress = Math.max(0, -(s.econ.sectorMom?.[rec.class] ?? 0)) * 40;
      const trade = industryStress(s.econ, t.sector) * 2.6;
      const pFail = 35e-5 * cycle * grade * (1 + sectorStress + trade);
      if (rng(s) >= pFail) continue;
      const kept = Math.round(t.deposit ?? 0);
      h.tenants.splice(i, 1);
      const down = Math.max(2, Math.round((rec.class === "office" ? 6 : 4) * rrange(s, 0.8, 1.5)));
      h.makeReady = [...h.makeReady ?? [], { sf: t.sf, readyM: q + down, use: t.use }];
      s.news.unshift({
        q,
        kind: "warn",
        text: `${t.name} filed and went dark at ${rec.address} \u2014 ${(t.sf / 1e3).toFixed(1)}k sf back with ${(t.endM - q) / 12 > 1 ? `${((t.endM - q) / 12).toFixed(1)} years` : `${t.endM - q} months`} left on the lease. You kept their $${(kept / 1e3).toFixed(0)}K deposit \u2014 which is a month of the hole, not a year of it.`
      });
    }
    for (const t of h.tenants) {
      const age = q - t.startM;
      if (age > 0 && age % 12 === 0) t.rentPsf = +(t.rentPsf * 1.025).toFixed(2);
    }
    for (let i = 0; i < h.tenants.length && !h.leasingHold; i++) {
      const t = h.tenants[i];
      if (t.endM !== q + 6) continue;
      if (s.lois.some((l) => l.bbl === h.bbl && l.tenantIdx === i)) continue;
      if (rng(s) < industryStress(s.econ, t.sector) * 0.55) {
        s.news.unshift({
          q,
          kind: "warn",
          text: `${t.name} is not renewing at ${rec.address} \u2014 ${INDUSTRY_LABEL[t.sector].toLowerCase()} is contracting and they are giving the space back. ${(t.sf / 1e3).toFixed(1)}k sf comes available ${monthLabel(t.endM)}.`
        });
        continue;
      }
      const market = managedRentPsfYr(rec, s.econ, h);
      const overMarket = t.rentPsf / Math.max(1, market);
      const leverage = overMarket > 1.05 ? 0.82 : overMarket < 0.9 ? 1 : 0.94;
      const soft = s.econ.phase === "recession" ? 0.88 : s.econ.phase === "recovery" ? 0.95 : 1;
      const creditDisc = t.credit === 2 ? 0.97 : t.credit === 1 ? 1 : 1.02;
      const stress = industryStress(s.econ, t.sector);
      const boom = Math.max(0, s.econ.industryMom?.[t.sector] ?? 0) * 6;
      const trade = 1 - stress * 0.14 + boom;
      const ask = market * leverage * soft * creditDisc * clampL(trade, 0.78, 1.18);
      s.lois.push({
        id: s.nextLoiId++,
        bbl: h.bbl,
        kind: "renewal",
        // A renewal is for the space the tenant is ALREADY in. This carried no
        // use at all, so signing one fell through to the building's dominant
        // use — and in a residential-leaning mixed building that is the flats,
        // which put a named commercial tenant in the housing.
        use: t.use ?? leasableUses(rec)[0] ?? "office",
        name: t.name,
        sector: t.sector,
        credit: t.credit,
        sf: t.sf,
        rentPsf: +Math.max(market * 0.6, ask).toFixed(2),
        termM: Math.round(rrange(s, 36, 84)),
        // A sitting tenant asks for less than a new one — no fit-out, no
        // moving costs to cover — but the same market decides how far they get.
        tiPsf: Math.round(rrange(s, 2, 9) * concessionPressure(s.econ, t.use ?? "office")),
        freeM: rng(s) < 0.25 * concessionPressure(s.econ, t.use ?? "office") ? Math.round(rrange(s, 1, 3) * concessionPressure(s.econ, t.use ?? "office")) : 0,
        net: t.net,
        recovery: recoveryOf(t),
        expiresM: t.endM,
        tenantIdx: i
      });
    }
    const vac = vacantSf(rec, h) - notReadySf(h, q);
    const openLois = s.lois.filter((l) => l.bbl === h.bbl && l.kind === "new").length;
    const loiCap = vac > rec.bldgArea * 0.5 ? 3 : 2;
    if (!renovating && !h.leasingHold && vac >= PART_SUITE_MIN && openLois < loiCap) {
      const phaseAdj = s.econ.phase === "expansion" ? 0.14 : s.econ.phase === "recession" ? -0.14 : 0;
      const condAdj = h.condition === "good" ? 0.1 : h.condition === "worn" ? -0.1 : 0;
      const stanceAdj = -0.12 * (h.stance ?? 0);
      const lobbyAdj = h.programsDone?.lobby !== void 0 ? 0.08 : 0;
      const brokerMult = h.broker ? 1.75 : 1;
      const leaseUp = h.deliveredM !== void 0 && q - h.deliveredM <= 30 ? 1.9 : 1;
      const emptyPush = 1 + 0.45 * (vac / Math.max(1, rec.bldgArea));
      const openLegs = leasableUses(rec).map((u) => ({ u, free: useVacantSf(rec, h, u, q) })).filter((x) => x.free > 400);
      if (!openLegs.length) continue;
      let pickWeight = rng(s) * openLegs.reduce((a, x) => a + x.free, 0);
      let leg = openLegs[0];
      for (const x of openLegs) {
        pickWeight -= x.free;
        if (pickWeight <= 0) {
          leg = x;
          break;
        }
      }
      const use = leg.u;
      const legVac = leg.free;
      const spec = h.specSuites;
      const specLive = spec !== void 0 && spec.use === use && s.month >= spec.readyM;
      const specMult = specLive ? 1.9 : 1;
      const mom = s.econ.sectorMom?.[use] ?? 0;
      const sectorAdj = mom * 9;
      const jobsMult = Math.max(0.55, Math.min(1.6, 0.65 + 0.35 * (s.econ.employIdx ?? 1)));
      const supplyMult = Math.max(0.5, 1 - 34 * (s.econ.supplyPress?.[use] ?? 0));
      const marketPull = vacancyPull(s.econ, use);
      const p = Math.min(0.75, Math.max(0.01, 0.155 + demandLinear(rec.demandScore) / 200 + phaseAdj + condAdj + stanceAdj + lobbyAdj + sectorAdj) / 3.1 * brokerMult * specMult * leaseUp * emptyPush * jobsMult * supplyMult * marketPull);
      if (rng(s) < p) {
        const sector = pickSector(s, use);
        const [tiLo, tiHi] = TI_ASK[use] ?? TI_ASK.office;
        const concession = concessionPressure(s.econ, use);
        const market = managedRentPsfYr(rec, s.econ, h, use);
        const want = use === "industrial" ? rng(s) < 0.6 ? legVac : legVac * rrange(s, 0.5, 0.9) : useSuiteSf(rec, use) * Math.max(1, Math.round(rrange(s, 1, 3.4)));
        const sf = toSuites(rec, want, legVac, use);
        if (!sf) continue;
        const credit = rollCredit(s, demandLinear(rec.demandScore));
        const termM = Math.round(
          (credit === 2 ? rrange(s, 84, 144) : credit === 1 ? rrange(s, 60, 108) : rrange(s, 36, 60)) * (sf > useSuiteSf(rec, use) * 2.5 ? 1.15 : 1) * (s.econ.phase === "recession" ? 0.85 : 1)
        );
        s.lois.push({
          id: s.nextLoiId++,
          bbl: h.bbl,
          use,
          kind: "new",
          name: pickName(s, sector),
          sector,
          credit,
          sf,
          // A wide spread on purpose. If every prospect offers within a few
          // per cent of asking, the accept/counter/pass modal is a formality.
          // Some of these should be worth refusing, and refusing should hurt.
          // Turnkey space is worth a premium and asks for no allowance —
          // the fit-out is already standing there, paid for, in the suite the
          // tenant just walked through.
          rentPsf: +(market * (specLive ? 1.05 : 1) * (rng(s) < 0.3 ? rrange(s, 0.68, 0.86) : rrange(s, 0.9, 1.1))).toFixed(2),
          // Term length is not random. A credit tenant taking a whole floor
          // signs long paper and expects to be paid for it; a small unrated
          // firm wants three years and an out. WALT is the thing a buyer
          // actually underwrites, and it has to be earned tenant by tenant.
          // Real terms: an investment-grade covenant signs seven to twelve
          // years, a solid mid-market firm five to nine, a small unrated one
          // three to five with a break. The old band ran to fifteen years as a
          // matter of course, which handed the player bond-like income on
          // ordinary space and made WALT a number nobody had to work for.
          termM,
          // Concessions are the first thing to move when a market turns, and
          // they move long before face rents do. A landlord holding headline
          // rent while giving away a year of free rent is the oldest tell in
          // the business.
          tiPsf: Math.round(rrange(s, tiLo, tiHi) * concession * (credit === 2 ? 1.35 : credit === 1 ? 1.05 : 0.85) * (specLive ? 0.12 : 1)),
          // Free rent scales with the LENGTH of the deal, the way it does in
          // life — the rule of thumb is about a month a year, and it is the
          // concession a landlord gives before cutting the face rent. A flat
          // nought-to-six-and-a-half band handed a three-year tenant the same
          // holiday as a twelve-year one, and handed both of them one in a
          // market where nobody had to give anything away.
          freeM: Math.max(0, Math.round(termM / 12 * rrange(s, 0.25, 0.85) * concession)),
          net: use === "office" ? rng(s) < 0.8 : rng(s) < 0.4,
          recovery: rollRecovery(s, use),
          expiresM: q + 3
        });
        s.news.unshift({ q, kind: "info", text: `LOI in at ${rec.address} \u2014 check the Deals desk.` });
      }
    }
  }
  if (s.agent) runAgent(s, parcels);
}
var AGENT_FEE = 0.06;
var SPEC_COST_PSF = { office: 48, retail: 26, industrial: 9, multifamily: 0 };
var SPEC_MONTHS = 4;
function specSuiteQuote(s, rec, h, use, sf) {
  const psf = SPEC_COST_PSF[use] ?? SPEC_COST_PSF.office;
  if (!psf) return null;
  const open = useVacantSf(rec, h, use, s.month);
  const take = Math.max(0, Math.min(Math.round(sf), Math.round(open)));
  if (take < (use === "multifamily" ? 450 : COMMERCIAL_SUITE_MIN)) return null;
  return { sf: take, cost: Math.round(take * psf * s.econ.costIdx), readyM: s.month + SPEC_MONTHS, use };
}
function buildSpecSuites(s, parcels, bbl, use, sf) {
  const h = s.holdings[bbl];
  const rec = h ? resolveRec(parcels, s, bbl) : null;
  if (!h || !rec) return { s, err: "You don't own that." };
  if (h.specSuites) return { s, err: "There is already pre-built space going in here." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  const q = specSuiteQuote(s, rec, h, use, sf);
  if (!q) return { s, err: "There is not enough open space to pre-build, or this class does not fit out." };
  if (s.cash < q.cost) return { s, err: `Pre-building that runs $${(q.cost / 1e6).toFixed(2)}M \u2014 you're short.` };
  const next = JSON.parse(JSON.stringify(s));
  next.cash -= q.cost;
  logBooks(next, "leasing", q.cost);
  next.holdings[bbl].specSuites = { sf: q.sf, readyM: q.readyM, use };
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Pre-building ${(q.sf / 1e3).toFixed(0)}k sf of ${use} at ${rec.address} \u2014 $${(q.cost / 1e6).toFixed(2)}M, ready ${monthLabel(q.readyM)}. Turnkey space leases faster and dearer, and it is your money sitting in an empty suite until it does.`
  });
  return { s: next, msg: "Pre-build under way." };
}
function blendExtendQuote(s, rec, h, idx) {
  const t = h.tenants[idx];
  if (!t) return null;
  const left = (t.endM - s.month) / 12;
  if (left <= 0.75 || left > 6) return null;
  const market = managedRentPsfYr(rec, s.econ, h, t.use ?? rec.class);
  const over = t.rentPsf / Math.max(1, market);
  if (over < 0.92) return null;
  const newRent = +Math.max(market * 0.94, t.rentPsf * (over > 1.15 ? 0.88 : over > 1.02 ? 0.94 : 0.975)).toFixed(2);
  const addM = Math.round(clampN(36 + 48 * (over - 0.95), 24, 96));
  const annualGive = Math.round((t.rentPsf - newRent) * t.sf * left);
  return {
    idx,
    name: t.name,
    sf: t.sf,
    current: t.rentPsf,
    market,
    newRent,
    addM,
    newEndM: t.endM + addM,
    giveUp: Math.max(0, annualGive),
    // rent forgone over the remaining term
    // no fit-out on a renewal in place, but the broker still gets paid
    cost: Math.round(newRent * t.sf * ((left * 12 + addM) / 12) * 0.02)
  };
}
var clampN = (v, a, b) => Math.max(a, Math.min(b, v));
function blendExtend(s, parcels, bbl, idx) {
  const h = s.holdings[bbl];
  const rec = h ? resolveRec(parcels, s, bbl) : null;
  if (!h || !rec) return { s, err: "You don't own that." };
  const q = blendExtendQuote(s, rec, h, idx);
  if (!q) return { s, err: "There is no deal to do with that tenant right now." };
  if (s.cash < q.cost) return { s, err: "You cannot cover the commission on that." };
  const next = JSON.parse(JSON.stringify(s));
  const t = next.holdings[bbl].tenants[idx];
  next.cash -= q.cost;
  logBooks(next, "leasing", q.cost);
  t.rentPsf = q.newRent;
  t.endM = q.newEndM;
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Blend and extend at ${rec.address}: ${t.name} goes to $${q.newRent.toFixed(0)}/sf from $${q.current.toFixed(0)} and adds ${(q.addM / 12).toFixed(0)} years, out to ${monthLabel(q.newEndM)}. You bought term with rent \u2014 whether that was clever depends on what the market does next.`
  });
  return { s: next, msg: "Extended." };
}
function runAgent(s, parcels) {
  for (const loi of [...s.lois]) {
    const h = s.holdings[loi.bbl];
    const rec = resolveRec(parcels, s, loi.bbl);
    if (!h || !rec) continue;
    const market = managedRentPsfYr(rec, s.econ, h);
    if (loi.rentPsf < market * 0.82) {
      s.lois = s.lois.filter((l) => l.id !== loi.id);
      s.news.unshift({ q: s.month, kind: "info", text: `Your agent passed on ${loi.name} at ${rec.address} \u2014 the rent was under the market.` });
      continue;
    }
    const cost = loiSigningCost(loi, AGENT_FEE);
    if (s.cash < cost) continue;
    signLoi(s, rec, h, loi, AGENT_FEE);
    s.lois = s.lois.filter((l) => l.id !== loi.id);
  }
}
function leaseCosts(loi, feeRate) {
  const ti = loi.tiPsf * loi.sf;
  const rate = feeRate ?? (loi.kind === "new" ? 0.04 : 0.02);
  const lc = loi.rentPsf * loi.sf * (loi.termM / 12) * rate;
  return { ti: Math.round(ti), lc: Math.round(lc) };
}
function loiSigningCost(loi, feeRate) {
  const { ti, lc } = leaseCosts(loi, feeRate);
  return ti + lc;
}
function depositFor(s, rentPsf, sf, credit) {
  const monthly = rentPsf * sf / 12;
  const months = credit === 2 ? 1 : credit === 1 ? rrange(s, 1.2, 1.6) : rrange(s, 1.6, 2);
  return Math.round(monthly * months);
}
function depositsOn(h) {
  return h.tenants.reduce((a, t) => a + (t.deposit ?? 0), 0);
}
function depositsHeld(s) {
  let n = 0;
  for (const h of Object.values(s.holdings)) {
    for (const t of h.tenants) n += t.deposit ?? 0;
  }
  return n;
}
function signLoi(s, rec, h, l, feeRate) {
  if (l.kind === "new" && h.specSuites && h.specSuites.use === (l.use ?? rec.class) && s.month >= h.specSuites.readyM) {
    h.specSuites.sf -= l.sf;
    if (h.specSuites.sf < 800) delete h.specSuites;
  }
  const cost = loiSigningCost(l, feeRate);
  s.cash -= cost;
  logBooks(s, "leasing", cost);
  if (l.kind === "renewal" && l.tenantIdx !== void 0 && h.tenants[l.tenantIdx]) {
    const t = h.tenants[l.tenantIdx];
    t.rentPsf = l.rentPsf;
    t.endM = s.month + l.termM;
    if (recoveryOf(t) === "base") t.baseStopPsf = +stopPsfNow(rec, s.econ, h, t.use).toFixed(2);
    const wanted = depositFor(s, t.rentPsf, t.sf, t.credit);
    s.cash += wanted - (t.deposit ?? 0);
    t.deposit = wanted;
  } else {
    const use = l.use ?? leasableUses(rec)[0] ?? "office";
    const sf = Math.min(l.sf, Math.max(0, useVacantSf(rec, h, use, s.month)));
    const floorSf = use === "multifamily" ? 450 : COMMERCIAL_SUITE_MIN;
    if (sf < floorSf) {
      s.news.unshift({
        q: s.month,
        kind: "warn",
        text: `${l.name} lost the space at ${rec.address} \u2014 the other letter signed first and what is left (${Math.round(sf).toLocaleString()} sf) is under the ${floorSf.toLocaleString()} sf minimum. Two live letters on one floor is a race, and somebody always loses it.`
      });
      return;
    }
    const deposit = depositFor(s, l.rentPsf, sf, l.credit);
    s.cash += deposit;
    h.tenants.push({
      name: l.name,
      use,
      sector: l.sector,
      credit: l.credit,
      sf,
      rentPsf: l.rentPsf,
      net: l.net,
      recovery: l.recovery ?? (l.net ? "nnn" : "gross"),
      baseStopPsf: +stopPsfNow(rec, s.econ, h, use).toFixed(2),
      startM: s.month,
      endM: s.month + l.termM,
      freeUntilM: l.freeM ? s.month + l.freeM : void 0,
      deposit
    });
  }
  s.news.unshift({
    q: s.month,
    kind: "deal",
    text: `Signed${feeRate === AGENT_FEE ? " by your agent" : ""}: ${l.name} \u2014 ${l.sf.toLocaleString()} sf at ${rec.address}, $${l.rentPsf.toFixed(0)}/sf, ${(l.termM / 12).toFixed(0)} yrs${l.kind === "renewal" ? " (renewal)" : ""}.`
  });
}
function respondLOI(s, parcels, id, action, fund = false, counter) {
  const next = JSON.parse(JSON.stringify(s));
  const loi = next.lois.find((l) => l.id === id);
  if (!loi) return { s, msg: "", err: "That LOI is gone." };
  const h = next.holdings[loi.bbl];
  const rec = resolveRec(parcels, next, loi.bbl);
  if (!h || !rec) return { s, msg: "", err: "You no longer control that building." };
  let drawn = 0;
  const sign = (l) => {
    const cost = loiSigningCost(l);
    if (next.cash < cost) {
      const short = Math.ceil((cost - next.cash) / 1e3) * 1e3;
      if (!fund) return `Signing costs ${money(cost)} (TI + commission) \u2014 you're short ${money(short)}.`;
      const avail = locAvailable(next, parcels);
      if (short > avail) {
        return `Signing costs ${money(cost)}. You're short ${money(short)} and the line only has ${money(avail)} left.`;
      }
      const d = drawLoc(next, parcels, short);
      if (d.err) return d.err;
      Object.assign(next, d.s);
      drawn = short;
    }
    signLoi(next, rec, h, l);
    return null;
  };
  const drawNote = () => drawn ? ` Drew ${money(drawn)} on the line to fund it.` : "";
  if (action === "accept") {
    const err = sign(loi);
    if (err) return { s, msg: "", err };
    next.lois = next.lois.filter((l) => l.id !== id);
    return { s: next, msg: "Lease signed." + drawNote() };
  }
  if (action === "counter") {
    if (loi.stage === "countered") return { s, msg: "", err: "Their counter was final. Take it or pass." };
    if (loi.countered) return { s, msg: "", err: "You already countered \u2014 they're deciding." };
    loi.countered = true;
    if (loi.openRentPsf === void 0) loi.openRentPsf = loi.rentPsf;
    const askRent = counter?.rentPsf !== void 0 ? +counter.rentPsf.toFixed(2) : +(loi.rentPsf * 1.06).toFixed(2);
    const askTi = counter?.tiPsf !== void 0 ? Math.round(counter.tiPsf) : Math.round(loi.tiPsf * 0.7);
    const market = managedRentPsfYr(rec, next.econ, h, loi.use);
    const f = askRent / Math.max(1, market);
    const vacHere = next.econ.cityVac?.[loi.use ?? "office"] ?? 0.1;
    const natHere = loi.use === "multifamily" ? 0.045 : loi.use === "retail" ? 0.085 : loi.use === "industrial" ? 0.07 : 0.115;
    const tight = Math.max(-0.3, Math.min(0.35, (natHere - vacHere) * 3));
    const stick = loi.kind === "renewal" ? 0.14 : 0;
    const tiCut = loi.tiPsf > 0 ? Math.max(0, (loi.tiPsf - askTi) / Math.max(1, loi.tiPsf)) * 0.14 : 0;
    const pAccept = Math.max(0.04, Math.min(
      0.95,
      1.58 - f * 1.4 + loi.credit * 0.04 + tight + stick - tiCut + (next.econ.phase === "expansion" ? 0.06 : next.econ.phase === "recession" ? -0.08 : 0)
    ));
    const openedAt = loi.openRentPsf ?? loi.rentPsf;
    const openTi = loi.tiPsf;
    loi.askedRentPsf = askRent;
    loi.askedTiPsf = askTi;
    loi.rentPsf = askRent;
    loi.tiPsf = askTi;
    const reply = (outcome, theirRent, theirTi) => {
      if (!next.leaseReplies) next.leaseReplies = [];
      next.leaseReplies.unshift({
        m: next.month,
        bbl: loi.bbl,
        address: rec.address,
        name: loi.name,
        outcome,
        askedRentPsf: askRent,
        theirRentPsf: +theirRent.toFixed(2),
        askedTiPsf: askTi,
        theirTiPsf: theirTi,
        sf: loi.sf,
        marketPsf: +market.toFixed(2)
      });
      next.leaseReplies = next.leaseReplies.slice(0, 8);
    };
    if (rng(next) < pAccept) {
      const err = sign(loi);
      if (err) {
        next.lois = next.lois.filter((l) => l.id !== id);
        next.news.unshift({ q: next.month, kind: "warn", text: `${loi.name} took your counter at ${rec.address} and you could not fund the fit-out. The deal died.` });
        return { s: next, msg: "", err };
      }
      next.lois = next.lois.filter((l) => l.id !== id);
      reply("took", askRent, askTi);
      next.news.unshift({
        q: next.month,
        kind: "deal",
        text: `${loi.name} took your counter at ${rec.address}: $${askRent.toFixed(2)}/sf against the $${openedAt.toFixed(2)} they opened at \u2014 ${money((askRent - openedAt) * loi.sf)} a year more rent` + (openTi !== askTi ? ` and ${money((openTi - askTi) * loi.sf)} less fit-out.` : ".")
      });
      return { s: next, msg: `${loi.name} took your counter \u2014 $${askRent.toFixed(2)}/sf.` + drawNote() };
    }
    const pWalk = Math.max(0.15, Math.min(0.92, 0.24 + (f - 1) * 2.2));
    if (rng(next) < pWalk) {
      next.lois = next.lois.filter((l) => l.id !== id);
      reply("walked", openedAt, openTi);
      next.news.unshift({ q: next.month, kind: "warn", text: `${loi.name} walked on the counter at ${rec.address} \u2014 $${askRent.toFixed(2)}/sf was more than the space was worth to them (market ~$${market.toFixed(2)}). You had $${openedAt.toFixed(2)} on the table.` });
      return { s: next, msg: `${loi.name} walked. You asked $${askRent.toFixed(2)} against a $${market.toFixed(2)} market.` };
    }
    loi.stage = "countered";
    loi.counterRentPsf = +Math.min(askRent, Math.max(loi.rentPsf * 0.94, market * (0.95 + 0.04 * rng(next)))).toFixed(2);
    loi.counterTiPsf = Math.round((askTi + loi.tiPsf) / 2);
    loi.rentPsf = loi.counterRentPsf;
    loi.tiPsf = loi.counterTiPsf;
    reply("countered", loi.counterRentPsf, loi.counterTiPsf);
    next.news.unshift({ q: next.month, kind: "info", text: `${loi.name} countered at ${rec.address}: you asked $${askRent.toFixed(2)}/sf, they came back at $${loi.counterRentPsf.toFixed(2)}/sf with $${loi.counterTiPsf}/sf of TI. Final answer \u2014 take it or lose them.` });
    return { s: next, msg: `${loi.name} came back at $${loi.counterRentPsf.toFixed(2)}/sf \u2014 final.` };
  }
  next.lois = next.lois.filter((l) => l.id !== id);
  return { s: next, msg: "Passed." };
}
var BUYOUT_PREMIUM = 1.25;
function buyoutQuote(s, bbl) {
  const h = s.holdings[bbl];
  if (!h) return null;
  const rows = h.tenants.map((t) => {
    const monthsLeft = Math.max(0, t.endM - s.month);
    const annual = t.rentPsf * t.sf;
    return { name: t.name, monthsLeft, annual, cost: Math.round(annual / 12 * monthsLeft * BUYOUT_PREMIUM) };
  });
  return {
    cost: rows.reduce((a, r) => a + r.cost, 0),
    tenants: h.tenants.length,
    sf: h.tenants.reduce((a, t) => a + t.sf, 0),
    deposits: h.tenants.reduce((a, t) => a + (t.deposit ?? 0), 0),
    rows
  };
}
function buyOutTenants(s, parcels, bbl) {
  const h0 = s.holdings[bbl];
  if (!h0) return { s, err: "You don't own that." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const q = buyoutQuote(s, bbl);
  if (!q || !q.tenants && !(h0.occ ?? 0)) return { s, err: "Nobody to buy out \u2014 it is already empty." };
  const resSf = useSf(rec, "multifamily") * (h0.occ ?? 0);
  const resCost = Math.round(resSf * useRentPsfYr(rec, s.econ, h0.condition, "multifamily") * BUYOUT_PREMIUM);
  const total = q.cost + resCost;
  if (total <= 0) return { s, err: "Nobody to buy out \u2014 it is already empty." };
  if (s.cash < total) {
    return { s, err: `Clearing the building costs ${money(total)} \u2014 you're short ${money(total - s.cash)}.` };
  }
  const next = JSON.parse(JSON.stringify(s));
  const h = next.holdings[bbl];
  next.cash -= total;
  next.cash -= q.deposits;
  logBooks(next, "leasing", total);
  const n = h.tenants.length;
  const sf = q.sf + Math.round(resSf);
  h.tenants = [];
  h.occ = 0;
  h.makeReady = [];
  h.leasingHold = true;
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Bought out every lease at ${rec.address}: ${n} tenant${n === 1 ? "" : "s"} and ${(sf / 1e3).toFixed(1)}k sf for ${money(total)}, at ${((BUYOUT_PREMIUM - 1) * 100).toFixed(0)}% over the remaining contracts. The building is empty and letting is stopped \u2014 it is a site now.`
  });
  return { s: next, msg: `Empty. ${money(total)} to clear it.` };
}
function setLeasingHold(s, bbl, on) {
  const h = s.holdings[bbl];
  if (!h) return s;
  const next = JSON.parse(JSON.stringify(s));
  next.holdings[bbl].leasingHold = on || void 0;
  if (on) next.lois = next.lois.filter((l) => l.bbl !== bbl);
  return next;
}

// src/engine/demand.ts
var clamp5 = (v, a, b) => Math.max(a, Math.min(b, v));
var REACH_M = 270;
var RESPONSE = 46;
var MOMENTUM = 0.085;
var DRIFT_CAP = 34;
var CACHE = /* @__PURE__ */ new WeakMap();
var M_PER_DEG_LAT = 111320;
function contribution(cls, sf) {
  switch (cls) {
    case "office":
      return { j: sf / 230, r: 0, a: 0 };
    case "industrial":
      return { j: sf / 550, r: 0, a: 0 };
    case "retail":
      return { j: sf / 420, r: 0, a: sf };
    case "multifamily":
      return { j: 0, r: sf / 900, a: 0 };
  }
}
var MIXED_PROBE = { retail: 0.15, office: 0.45, multifamily: 0.4 };
function demandModel(parcels) {
  const hit = CACHE.get(parcels);
  if (hit) return hit;
  const bbls = Object.keys(parcels);
  if (!bbls.length) {
    const empty = { blocks: /* @__PURE__ */ new Map(), ofBbl: /* @__PURE__ */ new Map(), baseStock: /* @__PURE__ */ new Map(), e0: /* @__PURE__ */ new Map(), refJobs: 1, refPop: 1, refAmen: 1 };
    CACHE.set(parcels, empty);
    return empty;
  }
  let lat0 = 0, lon0 = 0;
  for (const b of bbls) {
    lon0 += parcels[b].centroid[0];
    lat0 += parcels[b].centroid[1];
  }
  lon0 /= bbls.length;
  lat0 /= bbls.length;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(lat0 * Math.PI / 180);
  const blocks = /* @__PURE__ */ new Map();
  const ofBbl = /* @__PURE__ */ new Map();
  const baseStock = /* @__PURE__ */ new Map();
  const acc = /* @__PURE__ */ new Map();
  for (const bbl of bbls) {
    const r = parcels[bbl];
    const id = r.block;
    ofBbl.set(bbl, id);
    const x = (r.centroid[0] - lon0) * mPerDegLon;
    const y = (r.centroid[1] - lat0) * M_PER_DEG_LAT;
    const a = acc.get(id) ?? { x: 0, y: 0, area: 0, dw: 0 };
    a.x += x * r.lotArea;
    a.y += y * r.lotArea;
    a.area += r.lotArea;
    a.dw += r.demandScore * r.lotArea;
    acc.set(id, a);
    if (r.class !== "land" && r.bldgArea > 0) {
      const st = baseStock.get(id) ?? {};
      const m = mixOf(r);
      for (const k of Object.keys(m)) st[k] = (st[k] ?? 0) + r.bldgArea * (m[k] ?? 0);
      baseStock.set(id, st);
    }
  }
  for (const [id, a] of acc) {
    blocks.set(id, {
      id,
      bbls: [],
      cx: a.x / Math.max(1, a.area),
      cy: a.y / Math.max(1, a.area),
      landArea: a.area,
      baseD: a.dw / Math.max(1, a.area),
      neighbours: [],
      nbLandArea: 0
    });
  }
  for (const bbl of bbls) blocks.get(ofBbl.get(bbl)).bbls.push(bbl);
  const list = [...blocks.values()];
  for (const b of list) {
    let nbArea = 0;
    for (const o of list) {
      const d = Math.hypot(b.cx - o.cx, b.cy - o.cy);
      if (d > REACH_M) continue;
      const w = b === o ? 1 : clamp5(1 - d / REACH_M, 0, 1);
      b.neighbours.push({ id: o.id, w });
      nbArea += o.landArea * w;
    }
    b.nbLandArea = Math.max(1, nbArea);
  }
  const model = { blocks, ofBbl, baseStock, e0: /* @__PURE__ */ new Map(), refJobs: 1, refPop: 1, refAmen: 1 };
  const dens = { j: [], r: [], a: [] };
  const raw = /* @__PURE__ */ new Map();
  for (const b of list) {
    let j = 0, r = 0, am = 0;
    for (const n of b.neighbours) {
      const st = baseStock.get(n.id);
      if (!st) continue;
      for (const k of Object.keys(st)) {
        const c = contribution(k, (st[k] ?? 0) * n.w * refOcc(k));
        j += c.j;
        r += c.r;
        am += c.a;
      }
    }
    const acres = b.nbLandArea / 43560;
    const v = { j: j / acres, r: r / acres, a: am / acres };
    raw.set(b.id, v);
    dens.j.push(v.j);
    dens.r.push(v.r);
    dens.a.push(v.a);
  }
  const p80 = (arr) => {
    const s = arr.slice().sort((x, y) => x - y);
    return Math.max(1e-6, s[Math.floor(s.length * 0.8)] ?? 1);
  };
  model.refJobs = p80(dens.j);
  model.refPop = p80(dens.r);
  model.refAmen = p80(dens.a);
  for (const b of list) {
    const v = raw.get(b.id);
    model.e0.set(b.id, emergenceOf(v.j / model.refJobs, v.r / model.refPop, v.a / model.refAmen));
  }
  CACHE.set(parcels, model);
  return model;
}
function emergenceOf(j, r, a) {
  const mix = Math.cbrt(Math.max(0, j) * Math.max(0, r) * Math.max(0, a));
  return mix / (mix + 0.55);
}
function occupiedStock(s, parcels, model) {
  const out = /* @__PURE__ */ new Map();
  const occFor = (cls) => marketOcc(cls, s.econ);
  for (const [id, st] of model.baseStock) {
    const o = {};
    for (const k of Object.keys(st)) o[k] = (st[k] ?? 0) * occFor(k);
    out.set(id, o);
  }
  const bump = (id, cls, sf) => {
    if (!id) return;
    const o = out.get(id) ?? {};
    o[cls] = (o[cls] ?? 0) + sf;
    out.set(id, o);
  };
  for (const [bbl, b] of Object.entries(s.built ?? {})) {
    const base = parcels[bbl];
    const id = model.ofBbl.get(bbl);
    if (!base || !id) continue;
    if (base.class !== "land" && base.bldgArea > 0) {
      const bm = mixOf(base);
      for (const k of Object.keys(bm)) bump(id, k, -base.bldgArea * (bm[k] ?? 0) * occFor(k));
    }
    if (b.bldgArea > 0 && b.class !== "land") {
      const nm = b.mix ?? { [b.class]: 1 };
      for (const k of Object.keys(nm)) bump(id, k, b.bldgArea * (nm[k] ?? 0) * occFor(k));
    }
  }
  for (const h of Object.values(s.holdings)) {
    const base = s.built?.[h.bbl];
    const rec = parcels[h.bbl];
    if (!rec) continue;
    const sf = base?.bldgArea ?? rec.bldgArea ?? 0;
    if (!sf) continue;
    const m = base?.mix ?? mixOf({ ...rec, class: base?.class ?? rec.class, mix: base?.mix });
    for (const cls of Object.keys(m)) {
      const share = m[cls] ?? 0;
      const compSf = sf * share;
      if (compSf <= 0) continue;
      const real = cls === "multifamily" ? h.occ ?? occFor(cls) : Math.min(1, h.tenants.filter((tn) => (tn.use ?? cls) === cls).reduce((n, tn) => n + tn.sf, 0) / compSf);
      bump(model.ofBbl.get(h.bbl), cls, (real - occFor(cls)) * compSf);
    }
  }
  return out;
}
function marketOcc(cls, econ) {
  return useOccupancy({ class: cls, demandScore: 55 }, econ, cls);
}
function refOcc(cls) {
  return marketOcc(cls, { cycleDev: 0 });
}
function tickDemand(s, parcels) {
  const model = demandModel(parcels);
  if (!model.blocks.size) return;
  const occ = occupiedStock(s, parcels, model);
  s.blockD = s.blockD ?? {};
  const mine = /* @__PURE__ */ new Map();
  for (const bbl of [...Object.keys(s.holdings), ...Object.keys(s.developments ?? {})]) {
    const id = model.ofBbl.get(bbl);
    if (id && !mine.has(id)) mine.set(id, parcels[bbl]?.address ?? bbl);
  }
  for (const b of model.blocks.values()) {
    let j = 0, r = 0, a = 0;
    for (const n of b.neighbours) {
      const st = occ.get(n.id);
      if (!st) continue;
      for (const k of Object.keys(st)) {
        const c = contribution(k, (st[k] ?? 0) * n.w);
        j += c.j;
        r += c.r;
        a += c.a;
      }
    }
    const acres = b.nbLandArea / 43560;
    const e = emergenceOf(j / acres / model.refJobs, r / acres / model.refPop, a / acres / model.refAmen);
    const target = clamp5((e - (model.e0.get(b.id) ?? e)) * RESPONSE, -DRIFT_CAP, DRIFT_CAP);
    const now = s.blockD[b.id] ?? 0;
    const next = +(now + (target - now) * MOMENTUM).toFixed(2);
    if (next === 0) delete s.blockD[b.id];
    else s.blockD[b.id] = next;
    const addr = mine.get(b.id);
    if (addr && Math.abs(next) > Math.abs(now) && Math.floor(Math.abs(next) / 10) > Math.floor(Math.abs(now) / 10)) {
      const step = Math.floor(Math.abs(next) / 10) * 10;
      s.news.unshift(next > 0 ? { q: s.month, kind: "deal", text: `The blocks around ${addr} have gained ${step} points of demand since you came in \u2014 rents, tenant quality and land are all repricing off it.` } : { q: s.month, kind: "warn", text: `The blocks around ${addr} have lost ${step} points of demand \u2014 space is emptying out around you, and the appraisal follows.` });
    }
  }
}
function demandNow(s, rec) {
  return clamp5(rec.demandScore + (s.blockD?.[rec.block] ?? 0), 2, 100);
}
function blockReport(s, parcels, block) {
  const model = demandModel(parcels);
  const b = model.blocks.get(block);
  if (!b) return null;
  const occ = occupiedStock(s, parcels, model);
  let j = 0, r = 0, a = 0;
  for (const n of b.neighbours) {
    const st = occ.get(n.id);
    if (!st) continue;
    for (const k of Object.keys(st)) {
      const c = contribution(k, (st[k] ?? 0) * n.w);
      j += c.j;
      r += c.r;
      a += c.a;
    }
  }
  const acres = b.nbLandArea / 43560;
  const norm = (jj, rr, aa) => emergenceOf(jj / acres / model.refJobs, rr / acres / model.refPop, aa / acres / model.refAmen);
  const mix = {
    jobs: j / acres / model.refJobs,
    residents: r / acres / model.refPop,
    amenity: a / acres / model.refAmen
  };
  const PROBE_SF = 6e4;
  const here = norm(j, r, a);
  const candidates = [
    { key: "office", mix: { office: 1 } },
    { key: "retail", mix: { retail: 1 } },
    { key: "multifamily", mix: { multifamily: 1 } },
    { key: "industrial", mix: { industrial: 1 } },
    { key: "mixed", mix: MIXED_PROBE }
  ];
  let wants = "mixed";
  let bestGain = -Infinity, secondGain = -Infinity;
  for (const cand of candidates) {
    let cj = 0, cr = 0, ca = 0;
    for (const u of Object.keys(cand.mix)) {
      const c = contribution(u, PROBE_SF * (cand.mix[u] ?? 0));
      cj += c.j;
      cr += c.r;
      ca += c.a;
    }
    const gain = norm(j + cj, r + cr, a + ca) - here;
    if (gain > bestGain) {
      secondGain = bestGain;
      bestGain = gain;
      wants = cand.key;
    } else if (gain > secondGain) secondGain = gain;
  }
  return {
    jobs: Math.round(j),
    residents: Math.round(r),
    amenitySf: Math.round(a),
    baseD: b.baseD,
    drift: s.blockD?.[block] ?? 0,
    mix,
    wants,
    balanced: !(bestGain > secondGain * 1.35)
  };
}

// src/engine/workout.ts
var clone = (s) => JSON.parse(JSON.stringify(s));
var NOTICE_M = 6;
var FORECLOSE_M = 8;
function workoutMood(s, lenderName) {
  const l = lenderByName(s, lenderName);
  const rel = s.lenderRel?.[lenderName] ?? 20;
  if (!l || l.failedM !== void 0) {
    return {
      willExtend: false,
      feePct: 0,
      bumpPct: 0,
      paydownPct: 0,
      why: "The lender is in receivership. A receiver does not grant extensions \u2014 they liquidate."
    };
  }
  const cr = capitalRatio(l);
  const healthy = cr > 0.075 && l.delinquent < 0.06;
  const stretched = cr > 0.05;
  const willExtend = healthy || stretched && rel > 45;
  return {
    willExtend,
    why: healthy ? `${lenderName} has the capital to be patient. They would rather have a performing loan than your building.` : stretched ? `${lenderName} is stretched \u2014 ${(l.delinquent * 100).toFixed(1)}% of their book is not paying. ` + (rel > 45 ? "Your record with them is the only reason this is a conversation." : "They have no reason to carry you.") : `${lenderName} is undercapitalised. They cannot carry a non-performing loan; the regulators are counting.`,
    // The price of time, and it is not small.
    feePct: healthy ? 0.01 : 0.02,
    bumpPct: healthy ? 1.5 : 3,
    paydownPct: healthy ? 0.03 : 0.08
  };
}
function openWorkout(s, bbl, cause, cure) {
  if (s.workouts?.[bbl]) return;
  const h = s.holdings[bbl];
  if (!h?.loan) return;
  if (!s.workouts) s.workouts = {};
  const lender = productById(h.loan.product).lender;
  s.workouts[bbl] = {
    bbl,
    lender,
    startM: s.month,
    stage: "notice",
    cause,
    cure: Math.round(cure),
    decideM: s.month + NOTICE_M,
    asks: 0,
    missedMs: 0
  };
  bumpLenderRel(s, lender, -6);
}
function cureWorkout(s, parcels, bbl) {
  const w = s.workouts?.[bbl];
  const h = s.holdings[bbl];
  if (!w || !h?.loan) return { s, err: "There is nothing in default there." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (s.cash < w.cure) return { s, err: `Curing it takes ${money2(w.cure)} \u2014 you are short ${money2(w.cure - s.cash)}.` };
  const next = clone(s);
  next.cash -= w.cure;
  logBooks(next, "debtSvc", w.cure);
  const nh = next.holdings[bbl];
  if (w.cause === "balloon") {
    nh.loan = null;
  } else {
    nh.loan.sweep = false;
    nh.loan.cleanQs = 0;
  }
  delete next.workouts[bbl];
  bumpLenderRel(next, w.lender, 4);
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Cured the default at ${rec.address} \u2014 ${money2(w.cure)} to ${w.lender}. They will remember that you found it, which is most of what a relationship is.`
  });
  return { s: next, msg: "Cured." };
}
function requestForbearance(s, parcels, bbl) {
  const w = s.workouts?.[bbl];
  const h = s.holdings[bbl];
  if (!w || !h?.loan) return { s, err: "There is nothing in default there." };
  if (w.stage === "foreclosure") return { s, err: "They have filed. That conversation is over." };
  if (w.asks >= 1) return { s, err: "You have already been to them once on this building. Nobody extends twice." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const mood = workoutMood(s, w.lender);
  const next = clone(s);
  const nw = next.workouts[bbl];
  nw.asks++;
  if (!mood.willExtend) {
    next.news.unshift({ q: next.month, kind: "warn", text: `${w.lender} refused to extend at ${rec.address}. ${mood.why}` });
    return { s: next, msg: "They said no." };
  }
  const bal = h.loan.balance;
  const fee = Math.round(bal * mood.feePct);
  const paydown = Math.round(bal * mood.paydownPct);
  const due = fee + paydown;
  if (next.cash < due) {
    return {
      s,
      err: `${w.lender} will extend \u2014 for a ${(mood.feePct * 100).toFixed(0)}% fee and a ${(mood.paydownPct * 100).toFixed(0)}% paydown, ${money2(due)} in total. You do not have it.`
    };
  }
  next.cash -= due;
  logBooks(next, "debtSvc", due);
  const nh = next.holdings[bbl];
  nh.loan.balance = Math.max(0, nh.loan.balance - paydown);
  nh.loan.ratePct = +(nh.loan.ratePct + mood.bumpPct).toFixed(2);
  nh.loan.maturityM = next.month + Math.round(rrange(next, 18, 30));
  nh.loan.sweep = true;
  nw.stage = "forbearance";
  nw.decideM = nh.loan.maturityM;
  next.news.unshift({
    q: next.month,
    kind: "info",
    text: `${w.lender} extended at ${rec.address} to ${monthLabel(nh.loan.maturityM)}: ${money2(fee)} of fees, ${money2(paydown)} paid down, and the coupon goes to ${nh.loan.ratePct.toFixed(2)}% with cash flow swept. You bought time and it was not cheap.`
  });
  return { s: next, msg: "Extended." };
}
function deedInLieu(s, parcels, bbl) {
  const w = s.workouts?.[bbl];
  const h = s.holdings[bbl];
  if (!w || !h?.loan) return { s, err: "There is nothing in default there." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const next = clone(s);
  const value = holdingValue(rec, next.econ, h, next.month);
  const bal = h.loan.balance;
  const loss = Math.max(0, bal - value * 0.88);
  chargeLenderLoss(next, w.lender, loss);
  bumpLenderRel(next, w.lender, -12);
  next.exits.push({
    bbl,
    address: rec.address,
    boughtM: h.boughtM,
    soldM: next.month,
    price: Math.round(bal),
    basis: h.costBasis,
    gain: Math.round(bal - h.costBasis),
    forced: true
  });
  recordComp(next, rec, Math.round(bal), w.lender, "You", true, h.condition);
  if (next.groundLeases?.[bbl]) delete next.groundLeases[bbl];
  next.cash -= depositsOn(next.holdings[bbl]);
  delete next.holdings[bbl];
  delete next.workouts[bbl];
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  markSponsor(next, "forced", rec.address, 0);
  next.news.unshift({
    q: next.month,
    kind: "warn",
    text: `Handed ${rec.address} back to ${w.lender} \u2014 deed in lieu. The debt is settled in full, there is no deficiency and no auction, and it still goes on your record. ${loss > 0 ? `They took a ${money2(loss)} loss on it.` : "They came out whole."}`
  });
  return { s: next, msg: "Keys handed over." };
}
function tickWorkouts(s, parcels) {
  if (!s.workouts) return;
  for (const w of Object.values(s.workouts)) {
    const h = s.holdings[w.bbl];
    const rec = resolveRec(parcels, s, w.bbl);
    if (!h?.loan || !rec) {
      delete s.workouts[w.bbl];
      continue;
    }
    if (w.cause === "covenant" && !h.loan.sweep) {
      delete s.workouts[w.bbl];
      s.news.unshift({ q: s.month, kind: "info", text: `${rec.address} is performing again \u2014 ${w.lender} has closed the file.` });
      continue;
    }
    if (s.month < w.decideM) continue;
    if (w.stage === "notice" || w.stage === "forbearance") {
      w.stage = "foreclosure";
      w.decideM = s.month + FORECLOSE_M;
      bumpLenderRel(s, w.lender, -10);
      s.news.unshift({
        q: s.month,
        kind: "warn",
        text: `${w.lender} has filed to foreclose on ${rec.address}. The auction is set for ${monthLabel(w.decideM)} \u2014 you can still cure it or hand back the keys until the hammer falls, and a deed in lieu is worth far more to you than an auction is.`
      });
      continue;
    }
    const value = holdingValue(rec, s.econ, h, s.month);
    const gross = Math.round(value * distressPrice(s) * rrange(s, 0.82, 0.94));
    const bal = h.loan.balance;
    const recourse = h.loan.recourse;
    const shortfall = Math.max(0, bal - gross);
    const surplus = Math.max(0, gross - bal);
    if (surplus > 0) {
      s.cash += surplus;
      logBooks(s, "sold", surplus);
    }
    if (shortfall > 0) {
      if (recourse) {
        s.cash -= shortfall;
        logBooks(s, "debtSvc", shortfall);
      } else chargeLenderLoss(s, w.lender, shortfall);
    }
    s.exits.push({
      bbl: w.bbl,
      address: rec.address,
      boughtM: h.boughtM,
      soldM: s.month,
      price: gross,
      basis: h.costBasis,
      gain: gross - h.costBasis,
      forced: true
    });
    recordComp(s, rec, gross, "the auction", "You", true, h.condition);
    if (s.groundLeases?.[w.bbl]) delete s.groundLeases[w.bbl];
    s.cash -= depositsOn(s.holdings[w.bbl]);
    delete s.holdings[w.bbl];
    delete s.workouts[w.bbl];
    s.lois = s.lois.filter((l) => l.bbl !== w.bbl);
    markSponsor(s, shortfall > 0 && recourse ? "deficiency" : "seized", rec.address, shortfall);
    bumpLenderRel(s, w.lender, -20);
    s.news.unshift({
      q: s.month,
      kind: "warn",
      text: `${rec.address} went to auction at ${money2(gross)} \u2014 ${(100 * (1 - gross / Math.max(1, value))).toFixed(0)}% under the mark. ` + (shortfall > 0 ? recourse ? `You signed for this one: the ${money2(shortfall)} shortfall came out of your account.` : `The paper was non-recourse, so ${w.lender} ate the ${money2(shortfall)}.` : `It cleared the debt and ${money2(surplus)} came back to you.`)
    });
  }
}
var money2 = (n) => Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1e3)}K`;

// src/engine/debt.ts
var PRODUCTS = [
  {
    id: "harbor",
    label: "First Harbor Bank \xB7 5 yr, 25-yr am",
    lender: "First Harbor Bank",
    blurb: "The hometown bank. Small checks, honest spreads, recourse \u2014 and they answer the phone in a crunch, for their friends.",
    ltv: 0.68,
    spread: 1.95,
    floating: false,
    ioM: 0,
    amortYears: 25,
    termM: 60,
    uwDscr: 1.25,
    debtYield: 0.09,
    points: 6e-3,
    recourse: true,
    prepay: "stepdown",
    prepayM: 36,
    minDSCR: 1.25,
    maxLTV: 0.82,
    maxLoan: 6e6
  },
  {
    id: "savings",
    label: "Alden Savings & Trust \xB7 7 yr, 30-yr am",
    lender: "Alden Savings & Trust",
    blurb: "The regional. Bigger checks, covenant-happy, and they tighten fast when the cycle turns.",
    ltv: 0.72,
    spread: 2.1,
    floating: false,
    ioM: 0,
    amortYears: 30,
    termM: 84,
    uwDscr: 1.25,
    debtYield: 0.085,
    points: 8e-3,
    recourse: false,
    prepay: "stepdown",
    prepayM: 48,
    minDSCR: 1.25,
    maxLTV: 0.85,
    maxLoan: 25e6
  },
  {
    // the 25-year sheet: same desk, sharper rate, faster paydown
    id: "savings25",
    label: "Alden Savings & Trust \xB7 7 yr, 25-yr am \xB7 \u221225bps",
    lender: "Alden Savings & Trust",
    blurb: "Faster paydown buys a sharper rate. Less cash flow, more equity, and the bank sleeps better than you do.",
    ltv: 0.72,
    spread: 1.85,
    floating: false,
    ioM: 0,
    amortYears: 25,
    termM: 84,
    uwDscr: 1.25,
    debtYield: 0.085,
    points: 8e-3,
    recourse: false,
    prepay: "stepdown",
    prepayM: 48,
    minDSCR: 1.25,
    maxLTV: 0.85,
    maxLoan: 25e6
  },
  {
    id: "pelican",
    label: "Pelican Life Insurance \xB7 15 yr, 30-yr am",
    lender: "Pelican Life Insurance",
    blurb: "Life-company money: the cheapest debt in town, for well-kept product only. Low leverage, long memory, brutal to leave early.",
    ltv: 0.58,
    spread: 1.5,
    floating: false,
    ioM: 0,
    amortYears: 30,
    termM: 180,
    uwDscr: 1.35,
    debtYield: 0.095,
    points: 8e-3,
    recourse: false,
    prepay: "yieldmaint",
    prepayM: 144,
    minDSCR: 1.3,
    maxLTV: 0.8,
    minLoan: 4e6,
    minCondition: "good"
  },
  {
    id: "conduit",
    label: "Meridian Street conduit \xB7 10 yr, 5 yr IO",
    lender: "Meridian Street Capital",
    blurb: "The CMBS desk. Sharp pricing on big loans, five interest-only years \u2014 and the window slams shut the day markets wobble.",
    ltv: 0.75,
    spread: 1.9,
    floating: false,
    ioM: 60,
    amortYears: 30,
    termM: 120,
    uwDscr: 1.2,
    debtYield: 0.08,
    points: 0.01,
    recourse: false,
    prepay: "yieldmaint",
    prepayM: 108,
    minDSCR: 1.15,
    maxLTV: 0.85,
    minLoan: 1e7,
    window: true
  },
  {
    id: "cordage",
    label: "Cordage Debt Partners \xB7 3 yr, floating IO",
    lender: "Cordage Debt Partners",
    blurb: "The debt fund. They will lend on anything, at a price, in any market. The price is the point.",
    ltv: 0.8,
    spread: 4.1,
    floating: true,
    ioM: 36,
    amortYears: 30,
    termM: 36,
    uwDscr: 0.9,
    debtYield: 0.055,
    points: 0.02,
    recourse: false,
    prepay: "open",
    prepayM: 0,
    minDSCR: 0.9,
    maxLTV: 0.92
  },
  {
    id: "mezz",
    label: "Cordage mezzanine \xB7 behind the senior",
    lender: "Cordage Debt Partners",
    blurb: "Stacks to 85%. The coupon is why nobody does this twice.",
    ltv: 0.85,
    spread: 8,
    floating: false,
    ioM: 120,
    amortYears: 30,
    termM: 84,
    uwDscr: 1.05,
    debtYield: 0.055,
    points: 0.025,
    recourse: false,
    prepay: "stepdown",
    prepayM: 48,
    mezz: true,
    minDSCR: 1,
    maxLTV: 0.95
  },
  {
    // Land has no income, so nobody else on this street will touch it. Small,
    // short, recourse — the hometown bank doing a favor it expects returned.
    id: "land",
    label: "First Harbor land loan \xB7 3 yr, recourse",
    lender: "First Harbor Bank",
    blurb: "The only money that will look at dirt. Half the price, and you sign for it.",
    ltv: 0.5,
    spread: 3.6,
    floating: true,
    ioM: 36,
    amortYears: 30,
    termM: 36,
    uwDscr: 0,
    debtYield: 0,
    points: 0.015,
    recourse: true,
    prepay: "open",
    prepayM: 0,
    minDSCR: 0,
    maxLTV: 0.7
  }
];
function windowOpen(s, p) {
  if (lenderAppetite(s, p.lender) < 0.12) return false;
  if (!p.window) return true;
  return (s.econ.creditIdx ?? 1) >= 0.78 && s.econ.phase !== "recession";
}
function lenderRelOf(s, lender) {
  return s.lenderRel?.[lender] ?? 20;
}
function relDiscount(s, p) {
  if (p.window || p.id === "cordage" || p.id === "mezz") return 0;
  return Math.min(0.4, Math.max(0, (lenderRelOf(s, p.lender) - 20) * 5e-3));
}
function bumpLenderRel(s, lender, amt) {
  if (!lender) return;
  if (!s.lenderRel) s.lenderRel = {};
  s.lenderRel[lender] = Math.max(0, Math.min(100, (s.lenderRel[lender] ?? 20) + amt));
}
var productById = (id) => PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0];
var REFI_FEE = 0.01;
function productOpen(s, p) {
  if (sponsorStanding(s).institutional) return true;
  return p.id === "cordage" || p.id === "mezz" || p.id === "land";
}
function prepayPenalty(loan, month) {
  const p = loan.prepay ?? "open";
  const left = Math.max(0, (loan.prepayUntilM ?? 0) - month);
  if (p === "open" || left <= 0) return 0;
  if (p === "stepdown") {
    const yearsLeft = Math.ceil(left / 12);
    return Math.round(loan.balance * Math.min(0.05, 0.01 * yearsLeft));
  }
  const yrs = left / 12;
  return Math.round(loan.balance * (loan.ratePct / 100) * yrs * 0.62);
}
function monthlyPayment(principal, ratePct, years) {
  const i = ratePct / 100 / 12;
  const n = years * 12;
  return principal * i / (1 - Math.pow(1 + i, -n));
}
function quote(s, product, price, noiYr2) {
  const ci = s.econ.creditIdx ?? 1;
  const tight = Math.max(0, 1 - ci);
  const st = sponsorStanding(s);
  const rel = relDiscount(s, product);
  const crunchEase = product.id === "harbor" && lenderRelOf(s, product.lender) >= 55 ? 0.5 : 1;
  const app = lenderAppetite(s, product.lender);
  const appMult = Math.min(1.02, 0.55 + 0.45 * app);
  const ratePct = +(s.econ.indexRate + product.spread * (1 + 1.1 * tight * crunchEase) + 0.9 * tight * crunchEase + Math.max(0, 1 - app) * 0.8 + st.spreadAdd - rel).toFixed(2);
  const byLtv = product.ltv * (1 - 0.3 * tight * crunchEase) * (1 - st.advanceCut) * appMult * price;
  if (!windowOpen(s, product)) return { principal: 0, ratePct, dscrConstrained: false, dyConstrained: false, debtYield: 0 };
  if (product.maxLoan && byLtv > product.maxLoan) {
    return sizeRest(s, product, Math.min(byLtv, product.maxLoan), price, noiYr2, ratePct, tight);
  }
  if (product.minLoan && byLtv < product.minLoan) return { principal: 0, ratePct, dscrConstrained: false, dyConstrained: false, debtYield: 0 };
  if (product.uwDscr <= 0) {
    return { principal: Math.max(0, Math.round(byLtv)), ratePct, dscrConstrained: false, dyConstrained: false, debtYield: 0 };
  }
  return sizeRest(s, product, byLtv, price, noiYr2, ratePct, tight);
}
function sizeRest(s, product, byLtv, price, noiYr2, ratePct, tight) {
  void s;
  void price;
  const maxAnnualDS = Math.max(0, noiYr2) / (product.uwDscr + 0.25 * tight);
  const i = ratePct / 100;
  const byDscrIO = maxAnnualDS / i;
  const qp = monthlyPayment(1, ratePct, product.amortYears) * 12;
  const byDscrAmort = maxAnnualDS / qp;
  const byDscr = product.ioM >= 12 ? Math.min(byDscrIO, byDscrAmort * 1.08) : byDscrAmort;
  const dyFloor = product.debtYield * (1 + 0.35 * tight);
  const byDebtYield = dyFloor > 0 ? Math.max(0, noiYr2) / dyFloor : Infinity;
  const principal = Math.max(0, Math.round(Math.min(byLtv, byDscr, byDebtYield)));
  return {
    principal: product.minLoan && principal < product.minLoan ? 0 : principal,
    ratePct,
    dscrConstrained: byDscr < byLtv && byDscr <= byDebtYield,
    dyConstrained: byDebtYield < byLtv && byDebtYield < byDscr,
    debtYield: principal > 0 ? Math.max(0, noiYr2) / principal : 0
  };
}
function originate(s, product, price, noiYr2, lev = 1, condition) {
  if (!productOpen(s, product)) return null;
  if (!windowOpen(s, product)) return null;
  if (product.minCondition === "good" && condition !== void 0 && condition !== "good") return null;
  const full = quote(s, product, price, noiYr2);
  const qd = { ...full, principal: Math.round(full.principal * Math.max(0, Math.min(1, lev))) };
  if (qd.principal < 1e5) return null;
  const pmt = product.ioM > 0 ? Math.round(qd.principal * qd.ratePct / 100 / 12) : Math.round(monthlyPayment(qd.principal, qd.ratePct, product.amortYears));
  const capStrike = product.floating ? +(s.econ.indexRate + 1).toFixed(2) : void 0;
  const loanOut = {
    product: product.id,
    floating: product.floating,
    cap: capStrike !== void 0 ? { strike: capStrike, expiresM: s.month + Math.min(product.termM, CAP_TERM_M) } : void 0,
    capPremium: capStrike !== void 0 ? Math.round(qd.principal * 0.0125) : void 0,
    points: product.points,
    recourse: product.recourse,
    prepay: product.prepay,
    prepayUntilM: s.month + product.prepayM,
    kicker: product.kicker,
    principal: qd.principal,
    balance: qd.principal,
    ratePct: qd.ratePct,
    spread: product.spread,
    ioUntilM: s.month + product.ioM,
    amortYears: product.amortYears,
    maturityM: s.month + product.termM,
    monthlyPmt: pmt,
    minDSCR: product.minDSCR,
    maxLTV: product.maxLTV,
    sweep: false,
    cleanQs: 0,
    originM: s.month
  };
  bumpLenderRel(s, product.lender, 2);
  return loanOut;
}
function dscr(rec, s, h) {
  if (!h.loan) return null;
  const ds = h.loan.monthlyPmt * 12;
  if (ds <= 0) return null;
  return holdingNOIYr(rec, s.econ, h, s.month) / ds;
}
function ltv(rec, s, h) {
  if (!h.loan) return null;
  const v = holdingValue(rec, s.econ, h, s.month);
  return v > 0 ? h.loan.balance / v : null;
}
function tickLoan(s, rec, h, assetCF) {
  const loan = h.loan;
  if (!loan || !rec) return 0;
  const q = s.month;
  if (loan.floating ?? loan.product === "float") {
    if (loan.cap && q >= loan.cap.expiresM) {
      delete loan.cap;
      s.news.unshift({ q, kind: "info", text: `The rate cap at ${rec.address} expired \u2014 you're floating naked again.` });
    }
    const effIndex = loan.cap ? Math.min(s.econ.indexRate, loan.cap.strike) : s.econ.indexRate;
    loan.ratePct = +(effIndex + loan.spread).toFixed(2);
  }
  const io = q < loan.ioUntilM;
  {
    const yearsLeft = Math.max(1, loan.amortYears - (q - loan.originM) / 12);
    loan.monthlyPmt = io ? Math.ceil(loan.balance * loan.ratePct / 100 / 12) : Math.round(monthlyPayment(loan.balance, loan.ratePct, yearsLeft));
  }
  const interest = loan.balance * loan.ratePct / 100 / 12;
  const principalPay = io ? 0 : Math.max(0, Math.min(loan.balance, loan.monthlyPmt - interest));
  if (!loan.sweep && s.month % 12 === 0) bumpLenderRel(s, productById(loan.product).lender, 0.6);
  loan.balance = Math.max(0, loan.balance - principalPay);
  let cashOut = loan.monthlyPmt;
  const holiday = q < (loan.holidayUntilM ?? loan.originM + 12);
  const d = dscr(rec, s, h);
  const l = ltv(rec, s, h);
  const breached = !holiday && (d !== null && d < loan.minDSCR || l !== null && l > loan.maxLTV);
  if (breached) {
    if (!loan.sweep) {
      s.news.unshift({
        q,
        kind: "warn",
        text: `Covenant breach at ${rec.address} (${d !== null && d < loan.minDSCR ? `DSCR ${d.toFixed(2)}` : `LTV ${(100 * (l ?? 0)).toFixed(0)}%`}) \u2014 the lender trapped the cash flow.`
      });
    }
    if (!loan.sweep) bumpLenderRel(s, productById(loan.product).lender, -3);
    loan.sweep = true;
    loan.cleanQs = 0;
    loan.breachMs = (loan.breachMs ?? 0) + 1;
    if ((loan.breachMs ?? 0) >= 24 && !s.workouts?.[h.bbl]) {
      openWorkout(s, h.bbl, "covenant", Math.round(loan.balance * 0.12));
      s.news.unshift({
        q,
        kind: "warn",
        text: `Two years of broken covenants at ${rec.address} and no sign of a cure. ${productById(loan.product).lender} has moved it to their workout desk \u2014 pay down the loan, ask them to restructure, or hand back the deed before they file.`
      });
    }
  } else if (loan.sweep) {
    loan.cleanQs++;
    bumpLenderRel(s, productById(loan.product).lender, 0.1);
    if (loan.cleanQs >= 2) {
      loan.sweep = false;
      loan.breachMs = 0;
      s.news.unshift({ q, kind: "info", text: `Covenants cured at ${rec.address} \u2014 the sweep is off.` });
    }
  }
  if (loan.sweep) {
    const surplus = Math.max(0, assetCF - loan.monthlyPmt);
    if (surplus > 0) {
      loan.balance = Math.max(0, loan.balance - surplus);
      cashOut += surplus;
    }
  }
  if (loan.balance === 0) {
    h.loan = null;
    return cashOut;
  }
  if (q >= loan.maturityM && !s.workouts?.[h.bbl]) {
    const value = holdingValue(rec, s.econ, h, s.month);
    const noi = holdingNOIYr(rec, s.econ, h, q);
    const hair = collateralHaircut(h, q, s.econ);
    const ladder = ["savings", "harbor", "cordage"].map(productById).filter((p) => productOpen(s, p) && windowOpen(s, p));
    let product = ladder[ladder.length - 1] ?? PRODUCTS[0];
    let qd = { ...quote(s, product, value, noi), principal: 0 };
    const fee = Math.round(loan.balance * REFI_FEE);
    for (const cand of ladder) {
      const raw = quote(s, cand, value, noi);
      const sized = { ...raw, principal: Math.round(raw.principal * hair.mult) };
      product = cand;
      qd = sized;
      if (sized.principal >= loan.balance + fee) break;
    }
    if (qd.principal >= loan.balance + fee) {
      const rolled = loan.balance;
      h.loan = originate(s, product, value, noi, hair.mult);
      if (h.loan) {
        h.loan.balance = h.loan.principal = rolled;
        h.loan.monthlyPmt = Math.round(monthlyPayment(rolled, h.loan.ratePct, h.loan.amortYears));
      }
      s.cash -= fee;
      logBooks(s, "debtSvc", fee);
      s.news.unshift({
        q,
        kind: "deal",
        text: `Balloon at ${rec.address} rolled into new paper at ${qd.ratePct.toFixed(2)}% (fee $${(fee / 1e3).toFixed(0)}K). Want equity out? That's a refi you choose.`
      });
    } else {
      const shortfall = loan.balance + fee - qd.principal;
      if (s.cash >= shortfall) {
        s.cash -= shortfall;
        h.loan = qd.principal > 1e5 ? originate(s, product, value, noi) : null;
        s.news.unshift({
          q,
          kind: "warn",
          text: `Balloon at ${rec.address}: today's market only refinances $${(qd.principal / 1e6).toFixed(1)}M \u2014 you wrote a $${(shortfall / 1e6).toFixed(2)}M check to close the gap.`
        });
      } else {
        openWorkout(s, h.bbl, "balloon", loan.balance + fee);
        s.news.unshift({
          q,
          kind: "warn",
          text: `The balloon came due at ${rec.address} and there is no refinancing \u2014 today's market writes $${(qd.principal / 1e6).toFixed(1)}M against a $${(loan.balance / 1e6).toFixed(2)}M balance and you cannot cover the gap. ${productById(loan.product).lender} has put it in workout: you have until ${monthLabel(s.month + 6)} to cure it, ask them to extend, or hand back the deed before they file.`
        });
      }
    }
  }
  return cashOut;
}
var CAP_TERM_M = 36;
function rateCapCost(loan) {
  return Math.round(loan.balance * 0.0125);
}
function buyRateCap(s, parcels, bbl) {
  const next = JSON.parse(JSON.stringify(s));
  const h = next.holdings[bbl];
  const rec = resolveRec(parcels, next, bbl);
  if (!h || !rec) return { s, err: "You don't own that." };
  if (!h.loan || !(h.loan.floating ?? h.loan.product === "float")) return { s, err: "Caps hedge floating debt \u2014 this loan is fixed." };
  if (h.loan.cap) return { s, err: "This loan already carries a live cap." };
  const cost = rateCapCost(h.loan);
  if (next.cash < cost) return { s, err: `The cap desk wants $${(cost / 1e6).toFixed(2)}M premium \u2014 you're short.` };
  const strike = +(next.econ.indexRate + 0.5).toFixed(2);
  next.cash -= cost;
  logBooks(next, "debtSvc", cost);
  h.loan.cap = { strike, expiresM: next.month + CAP_TERM_M };
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Rate cap bought at ${rec.address}: index capped at ${strike.toFixed(2)}% for three years ($${(cost / 1e6).toFixed(2)}M premium).`
  });
  return { s: next };
}
function collateralHaircut(h, month, econ) {
  if (!h.tenants.length) return { mult: 1 };
  const conc = concentration(h);
  const w = walt(h, month);
  let sfTot = 0, wCredit = 0, rollSf = 0;
  for (const t of h.tenants) {
    sfTot += t.sf;
    wCredit += t.credit * t.sf;
    if (t.endM - month <= 24) rollSf += t.sf;
  }
  const credit = sfTot ? wCredit / sfTot : 0;
  const rollShare = sfTot ? rollSf / sfTot : 0;
  const concHit = Math.max(0, conc - 0.35) / 0.65 * (credit >= 1.6 && w >= 8 ? 0.1 : credit >= 1.6 ? 0.2 : 0.32);
  const rollHit = Math.max(0, rollShare - 0.3) / 0.7 * 0.18;
  const ind = econ ? industryConcentration(h, econ) : { share: 0, sector: null, stressed: 0 };
  const indHit = Math.max(0, ind.share - 0.5) / 0.5 * 0.16 + ind.stressed * 0.26;
  const mult = Math.max(0.5, 1 - concHit - rollHit - indHit);
  const why = indHit > 0.08 && ind.sector ? `${(ind.share * 100).toFixed(0)}% of the income is ${INDUSTRY_LABEL[ind.sector].toLowerCase()}${ind.stressed > 0.25 ? ", and that trade is contracting" : ""}` : concHit > 0.08 && rollHit > 0.05 ? `the biggest tenant is ${(conc * 100).toFixed(0)}% of the roll and ${(rollShare * 100).toFixed(0)}% of it rolls inside two years` : concHit > 0.08 ? `the biggest tenant is ${(conc * 100).toFixed(0)}% of the roll` : rollHit > 0.05 ? `${(rollShare * 100).toFixed(0)}% of the roll expires inside two years` : void 0;
  return { mult, why };
}
function refiQuotes(s, parcels, bbl) {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  if (!h || !rec) return { quotes: [], value: 0, payoff: 0 };
  const leaseUpM = h.deliveredM !== void 0 ? s.month - h.deliveredM : Infinity;
  const inLeaseUp = leaseUpM <= 48;
  const actualNoi = holdingNOIYr(rec, s.econ, h, s.month);
  const actualValue = holdingValue(rec, s.econ, h, s.month);
  let value = actualValue, noi = actualNoi;
  if (inLeaseUp && rec.class !== "land" && rec.bldgArea > 0) {
    const stabValue = assetValue(rec, s.econ, "good");
    const stabNoi = noiAfterTaxYr(rec, s.econ, "good", stabValue);
    const trust = 0.75 * Math.max(0.3, 1 - leaseUpM / 60);
    value = Math.max(actualValue, stabValue * trust);
    noi = Math.max(actualNoi, stabNoi * trust);
  }
  const hair = collateralHaircut(h, s.month, s.econ);
  const quotes = PRODUCTS.map((p) => {
    const raw = quote(s, p, value, noi);
    const q = { ...raw, principal: Math.round(raw.principal * hair.mult) };
    const annualDs = p.ioM > 0 ? q.principal * q.ratePct / 100 : monthlyPayment(Math.max(1, q.principal), q.ratePct, p.amortYears) * 12;
    const senior = h.loan && !h.loan.kicker && h.loan.product !== "mezz";
    return {
      id: p.id,
      label: p.label,
      blurb: p.blurb,
      ratePct: q.ratePct,
      maxProceeds: q.principal,
      ltvAtMax: value > 0 ? q.principal / value : 0,
      dscrAtMax: annualDs > 0 ? noi / annualDs : 0,
      debtYieldAtMax: q.principal > 0 ? noi / q.principal : 0,
      binding: q.dyConstrained ? "debt yield" : q.dscrConstrained ? "coverage" : "advance rate",
      ioM: p.ioM,
      termM: p.termM,
      amortYears: p.amortYears,
      points: p.points,
      recourse: p.recourse,
      prepay: p.prepay,
      prepayM: p.prepayM,
      kicker: p.kicker,
      floating: p.floating,
      available: !productOpen(s, p) || !windowOpen(s, p) ? false : p.minCondition === "good" && h.condition !== "good" ? false : p.mezz ? !!senior : p.uwDscr <= 0 ? rec.class === "land" : rec.class !== "land" && q.principal > 0,
      why: !productOpen(s, p) ? `This desk won't look at you \u2014 ${sponsorStanding(s).label}.` : !windowOpen(s, p) ? "The securitization window is closed \u2014 nobody is buying the bonds until markets reopen." : p.minCondition === "good" && h.condition !== "good" ? "Life-company money wants a well-kept building. Renovate first." : p.minLoan && q.principal === 0 && rec.class !== "land" ? `Below their minimum check \u2014 ${p.lender} doesn't underwrite anything under $${(p.minLoan / 1e6).toFixed(0)}M.` : hair.why && hair.mult < 0.95 && !p.mezz ? `Proceeds cut ${((1 - hair.mult) * 100).toFixed(0)}% \u2014 ${hair.why}.` : p.mezz && !senior ? "Mezzanine sits behind a senior loan \u2014 put one on first." : p.uwDscr <= 0 && rec.class !== "land" ? "Land money is for dirt. This one has a building on it." : p.uwDscr > 0 && rec.class === "land" ? "No income to underwrite \u2014 a vacant site only gets a land loan." : void 0
    };
  });
  return { quotes, value, payoff: h.loan?.balance ?? 0 };
}
function refinance(s, parcels, bbl, productId, lev = 1) {
  const next = JSON.parse(JSON.stringify(s));
  const h = next.holdings[bbl];
  const rec = resolveRec(parcels, next, bbl);
  if (!h || !rec) return { s, err: "You don't own that." };
  const product = productById(productId);
  if (!productOpen(next, product)) {
    return { s, err: `${product.label} won't quote you \u2014 ${sponsorStanding(next).label}. Bridge and mezzanine money will still talk.` };
  }
  const value = holdingValue(rec, next.econ, h, next.month);
  const noi = holdingNOIYr(rec, next.econ, h, next.month);
  const hair = collateralHaircut(h, next.month, next.econ);
  const full = quote(next, product, value, noi);
  const qd = { ...full, principal: Math.round(full.principal * hair.mult * Math.max(0, Math.min(1, lev))) };
  if (product.mezz && !h.loan) return { s, err: "Mezzanine sits behind a senior loan \u2014 put one on first." };
  const oldBal = h.loan?.balance ?? 0;
  const penalty = h.loan ? prepayPenalty(h.loan, next.month) : 0;
  const points = Math.round(qd.principal * product.points);
  const fee = Math.round(Math.max(qd.principal, oldBal) * REFI_FEE) + points + penalty;
  if (qd.principal < 1e5) return { s, err: "No lender will size a loan against this income." };
  if (qd.principal + next.cash < oldBal + fee) {
    return {
      s,
      err: penalty > 0 ? `Proceeds don't cover the payoff. Breaking the old loan early costs $${(penalty / 1e6).toFixed(2)}M in ${h.loan?.prepay === "yieldmaint" ? "yield maintenance" : "prepayment"}.` : "Proceeds don't cover the payoff \u2014 you're underwater on this refi."
    };
  }
  const newLoan = originate(next, product, value, noi, lev * hair.mult);
  if (!newLoan) return { s, err: "No lender will size a loan against this income." };
  next.cash += qd.principal - oldBal - fee;
  logBooks(next, "debtSvc", fee);
  h.loan = newLoan;
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Refinanced ${rec.address}: $${(qd.principal / 1e6).toFixed(2)}M at ${qd.ratePct.toFixed(2)}% (${product.label})` + (penalty > 0 ? `, after $${(penalty / 1e6).toFixed(2)}M to break the old paper.` : ".")
  });
  return { s: next };
}

// src/engine/lenders.ts
var KIND = {
  "First Harbor Bank": {
    kind: "bank",
    capitalRatio: 0.11,
    brittle: 0.5,
    blurb: "Deposits fund the book, so the losses have to be very bad before the lights go out. Small, local, and they remember who paid them in the bad years."
  },
  "Alden Savings & Trust": {
    kind: "bank",
    capitalRatio: 0.095,
    brittle: 0.8,
    blurb: "A regional with a regional's problem: big enough to have made every mistake in the cycle, small enough that three of them matter."
  },
  "Pelican Life Insurance": {
    kind: "life",
    capitalRatio: 0.18,
    brittle: 0.25,
    blurb: "Insurance float against long paper. The most patient money in the city and the most conservative \u2014 they are never the reason a crunch happens and never the ones who end it."
  },
  "Meridian Street Capital": {
    kind: "conduit",
    capitalRatio: 0.04,
    brittle: 2.4,
    blurb: "They do not hold the loan; they sell it. Which is fine until nobody is buying, and then this desk is not tightening \u2014 it is closed."
  },
  "Cordage Debt Partners": {
    kind: "fund",
    capitalRatio: 0.22,
    brittle: 1.1,
    blurb: "A fund with committed capital and no depositors to answer to. They lend into a crisis at crisis prices, which is the entire business model."
  }
};
var CONSTRUCTION_LENDER = "Alden Savings & Trust";
function lenderBlurb(name) {
  return KIND[name]?.blurb ?? "";
}
function lenderNames() {
  return [...new Set(PRODUCTS.map((p) => p.lender))];
}
function initLenders() {
  return lenderNames().map((name, i) => {
    const k = KIND[name] ?? { kind: "bank", capitalRatio: 0.1, brittle: 1 };
    const book = k.kind === "conduit" ? 9e8 : k.kind === "life" ? 64e7 : k.kind === "fund" ? 31e7 : name === "First Harbor Bank" ? 14e7 : 42e7;
    return {
      id: "L" + i,
      name,
      kind: k.kind,
      book,
      capital: Math.round(book * k.capitalRatio),
      delinquent: 8e-3,
      chargeOffsYr: 0,
      chargeOffsTotal: 0,
      netIncomeYr: 0,
      appetite: 1,
      yours: 0
    };
  });
}
function lenderByName(s, name) {
  return s.lenders?.find((l) => l.name === name);
}
function capitalRatio(l) {
  return l.book > 0 ? l.capital / l.book : 1;
}
function lenderHealth(l) {
  if (l.failedM !== void 0) {
    const back = Math.max(0, l.failedM + (l.reopenM ?? 18));
    return { word: `in receivership \u2014 the franchise is being sold, back around month ${back}`, bad: true };
  }
  const cr = capitalRatio(l);
  const target = KIND[l.name]?.capitalRatio ?? 0.1;
  if (cr < target * 0.45) return { word: "undercapitalised \u2014 not lending to anybody", bad: true };
  if (cr < target * 0.7) return { word: "impaired \u2014 rationing hard", bad: true };
  if (l.delinquent > 0.055) return { word: "working out problem loans", bad: true };
  if (cr > target * 1.25 && l.delinquent < 0.02) return { word: "flush and looking for paper", bad: false };
  return { word: "open for business", bad: false };
}
function lenderAppetite(s, name) {
  const l = lenderByName(s, name);
  if (!l) return 1;
  if (l.failedM !== void 0) return 0;
  return l.appetite;
}
function tickLenders(s) {
  if (!s.lenders?.length) s.lenders = initLenders();
  recountYours(s);
  const e = s.econ;
  const vac = e.cityVac ?? {};
  const nat = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 };
  let stress = 0, n = 0;
  for (const k of Object.keys(nat)) {
    stress += Math.max(0, (vac[k] ?? nat[k]) - nat[k]);
    n++;
  }
  stress = n ? stress / n : 0;
  for (const l of s.lenders) {
    if (l.failedM !== void 0) {
      if (s.month - l.failedM >= (l.reopenM ?? 18)) {
        const k2 = KIND[l.name] ?? { capitalRatio: 0.1 };
        l.book = Math.round(l.book * 0.55);
        l.capital = Math.round(l.book * k2.capitalRatio * 1.15);
        l.delinquent = 4e-3;
        l.appetite = 0.75;
        l.chargeOffsYr = 0;
        l.netIncomeYr = 0;
        delete l.failedM;
        delete l.reopenM;
        s.news.unshift({
          q: s.month,
          kind: "info",
          text: `${l.name} is lending again. The receiver sold the franchise, the new owners put fresh capital behind it and the bad paper stayed behind \u2014 the name on the door is the same and the credit committee is not. Smaller book, tighter standards, and one more desk answering the phone.`
        });
      }
      continue;
    }
    const k = KIND[l.name] ?? { capitalRatio: 0.1, brittle: 1 };
    const spread = 1.9;
    const performing = l.book * (1 - l.delinquent);
    const interest = performing * (e.indexRate + spread) / 100 / 12;
    const fundingRate = l.kind === "bank" ? Math.max(0, e.indexRate - 2.2) : l.kind === "life" ? Math.max(0, e.indexRate - 1.4) : l.kind === "conduit" ? e.indexRate + 0.3 : e.indexRate + 1.1;
    const funding = l.book * fundingRate / 100 / 12;
    const badTarget = 6e-3 + stress * 0.55 * k.brittle + (e.phase === "recession" ? 0.018 : e.phase === "recovery" ? 8e-3 : 0) * k.brittle + Math.max(0, 1 - (e.creditIdx ?? 1)) * 0.03 * k.brittle;
    l.delinquent = Math.max(2e-3, Math.min(0.35, l.delinquent + 0.1 * (badTarget - l.delinquent) + rrange(s, -15e-4, 15e-4)));
    const chargeOff = Math.round(l.book * l.delinquent * 0.33 / 12);
    l.chargeOffsYr += chargeOff;
    l.chargeOffsTotal += chargeOff;
    const net = Math.round(interest - funding - chargeOff);
    l.netIncomeYr += net;
    l.capital = Math.round(l.capital + net);
    const target = k.capitalRatio;
    const cr = capitalRatio(l);
    const raw = cr / Math.max(0.01, target);
    l.appetite = Math.max(0, Math.min(
      1.15,
      (raw - 0.55) / 0.6 * (l.kind === "conduit" ? Math.max(0.25, e.creditIdx ?? 1) : 1)
    ));
    l.book = Math.max(2e7, Math.round(l.book * (1 + (l.appetite > 0.8 ? 35e-4 : l.appetite > 0.4 ? 0 : -6e-3))));
    if (s.month % 12 === 0 && s.month > 0) {
      l.chargeOffsYr = 0;
      l.netIncomeYr = 0;
    }
    if (l.capital <= 0 && rng(s) < 0.35) {
      l.failedM = s.month;
      l.reopenM = Math.round(rrange(s, 12, 30));
      l.appetite = 0;
      s.news.unshift({
        q: s.month,
        kind: "warn",
        text: `${l.name} has failed. ${l.kind === "conduit" ? "The securitisation market took it with them" : "The regulators took the book"} \u2014 every loan they had outstanding is with a receiver now, and one fewer desk is quoting in this town.`
      });
    } else if (l.appetite < 0.15 && rng(s) < 0.04) {
      s.news.unshift({
        q: s.month,
        kind: "warn",
        text: `${l.name} has stopped quoting. ${(l.delinquent * 100).toFixed(1)}% of their book is not paying and their capital will not carry new loans.`
      });
    }
  }
}
function recountYours(s) {
  const by = {};
  for (const h of Object.values(s.holdings)) {
    if (!h.loan) continue;
    const lender = PRODUCTS.find((p) => p.id === h.loan.product)?.lender;
    if (lender) by[lender] = (by[lender] ?? 0) + h.loan.balance;
  }
  for (const d of Object.values(s.developments ?? {})) {
    by[CONSTRUCTION_LENDER] = (by[CONSTRUCTION_LENDER] ?? 0) + d.loanBalance;
  }
  for (const l of s.lenders ?? []) l.yours = Math.round(by[l.name] ?? 0);
}
function chargeLenderLoss(s, lender, loss) {
  const l = lenderByName(s, lender);
  if (!l || loss <= 0) return;
  l.capital = Math.round(l.capital - loss);
  l.chargeOffsYr += loss;
  l.chargeOffsTotal += loss;
  l.yours = Math.max(0, l.yours - loss);
  l.delinquent = Math.min(0.4, l.delinquent + loss / Math.max(1, l.book) * 0.6);
}

// src/engine/dev.ts
var clone2 = (s) => JSON.parse(JSON.stringify(s));
var HARD_COST_PSF = {
  office: 560,
  // net $62/sf against a 5.3% exit
  multifamily: 345,
  // net $37/sf against a 4.6% exit — the thinnest margin in the book
  retail: 865,
  // net $97/sf; podium retail is expensive and earns it
  industrial: 140
  // net $17/sf against a 6.6% exit
};
var MIXED_STACK = { retail: 0.15, office: 0.45, multifamily: 0.4 };
function normalizeMix(m) {
  const keys = Object.keys(m).filter((k) => (m[k] ?? 0) >= 0.03);
  const tot = keys.reduce((a, k) => a + (m[k] ?? 0), 0);
  if (!keys.length || tot <= 0) return { ...MIXED_STACK };
  const out = {};
  for (const k of keys) out[k] = +((m[k] ?? 0) / tot).toFixed(4);
  return out;
}
function devMix(use, custom) {
  if (use !== "mixed") return { [use]: 1 };
  return custom ? normalizeMix(custom) : { ...MIXED_STACK };
}
function dominantOf(mix) {
  return Object.keys(mix).sort((a, b) => (mix[b] ?? 0) - (mix[a] ?? 0))[0] ?? "office";
}
function overMix(mix, f) {
  let sum = 0, w = 0;
  for (const u of Object.keys(mix)) {
    const s = mix[u] ?? 0;
    sum += f(u) * s;
    w += s;
  }
  return w > 0 ? sum / w : 0;
}
function specShare(mix) {
  return (mix.office ?? 0) + (mix.retail ?? 0);
}
var SOFT_COST = 0.16;
var CONSTR_SPREAD = 2.4;
var CONTINGENCY = 0.06;
var CONTRACT_PREMIUM = { gmp: 0.04, costplus: 0 };
function constructionLtc(mix, phase, creditIdx, appetite = 1) {
  const spec = specShare(mix);
  const safeLtc = 0.7;
  const specLtc = 0.7;
  const base = specLtc * spec + safeLtc * (1 - spec);
  const tight = phase === "recession" ? 0.72 : phase === "peak" ? 0.94 : 1;
  const app = Math.min(1.05, 0.5 + 0.5 * appetite);
  return Math.max(0, Math.min(0.7, base * tight * app * Math.min(1.12, Math.max(0.55, creditIdx))));
}
function reserveFor(commitment, ratePct, months) {
  return commitment * 0.58 * (ratePct / 100) * (months / 12) * 1.16;
}
function farMaxFor(rec) {
  return Math.max(rec.farMaxComm, rec.farMaxRes, 2);
}
var FLOOR_HEIGHT_FT = 12.5;
var MAX_SLENDERNESS = 15;
var ABS_MAX_FLOORS = 90;
function physicalMaxFloors(plateSf) {
  if (plateSf < 400) return 1;
  const slender = 1.2 * Math.sqrt(plateSf);
  const core = 1 + (plateSf - 400) / 135;
  return Math.max(1, Math.min(ABS_MAX_FLOORS, Math.floor(Math.min(slender, core))));
}
var RETAIL_FLOORS_MAX = 2;
var MAX_FLOORS_BY_USE = { retail: RETAIL_FLOORS_MAX };
function capRetail(mix, floors) {
  const share = mix.retail ?? 0;
  if (share <= 0 || floors <= 0) return mix;
  const maxShare = RETAIL_FLOORS_MAX / floors;
  if (share <= maxShare) return mix;
  const others = Object.entries(mix).filter(([k]) => k !== "retail");
  const rest = others.reduce((a, [, v]) => a + v, 0);
  if (rest <= 0) return { retail: 1 };
  const out = { retail: +maxShare.toFixed(4) };
  const scale = (1 - maxShare) / rest;
  for (const [k, v] of others) out[k] = +(v * scale).toFixed(4);
  return out;
}
function maxFloorsFor(rec, coverage, use) {
  const zoning = Math.max(1, Math.floor(farMaxFor(rec) / Math.max(0.08, coverage)));
  const plate = (rec.lotArea ?? 0) * Math.max(0.08, coverage);
  const physical = rec.lotArea ? Math.max(1, Math.min(zoning, physicalMaxFloors(plate))) : zoning;
  const byUse = use ? MAX_FLOORS_BY_USE[use] : void 0;
  return byUse === void 0 ? physical : Math.min(physical, byUse);
}
function retailWantsMixed(rec, coverage = 0.6) {
  return maxFloorsFor(rec, coverage) > RETAIL_YIELDS_ABOVE;
}
var RETAIL_YIELDS_ABOVE = 6;
function asBuiltRec(rec, use, sf, floors) {
  const mix = devMix(use);
  return { ...rec, class: dominantOf(mix), mix, bldgArea: sf, floors };
}
function planDevelopment(s, parcels, bbl, use, floors, coverage = 0.6, contract = "gmp", ltcWanted, custom) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.lotArea) return null;
  const cov = Math.max(0.08, Math.min(0.9, coverage));
  const farMax = farMaxFor(rec);
  const raw = devMix(use, custom?.mix);
  const retailOnly = Object.entries(raw).every(([k, v]) => k === "retail" || !v);
  const fl = Math.max(1, Math.min(Math.round(floors), maxFloorsFor(rec, cov, retailOnly ? "retail" : use)));
  const sf = Math.round(rec.lotArea * cov * fl / 100) * 100;
  if (sf < 2e3) return null;
  const mix = capRetail(raw, fl);
  const heightPrem = fl > 30 ? 1.28 : fl > 18 ? 1.18 : fl > 8 ? 1.07 : 1;
  const hardCost = Math.round(sf * overMix(mix, (u) => HARD_COST_PSF[u]) * s.econ.costIdx * heightPrem * (1 + CONTRACT_PREMIUM[contract]));
  const softCost = Math.round(hardCost * SOFT_COST);
  const demo = rec.bldgArea > 0 ? Math.round(rec.bldgArea * 12 * s.econ.costIdx) : 0;
  const contingency = Math.round((hardCost + softCost) * CONTINGENCY);
  const openSf = sf;
  const tiPsf = overMix(mix, (u) => u === "office" ? 32 : u === "retail" ? 22 : u === "industrial" ? 5 : 7);
  const lcPsf = overMix(mix, (u) => u === "multifamily" ? 0 : 1) * marketRentPsfYr(asBuiltRec(rec, use, sf, fl), s.econ, "good") * 6 * 0.045;
  const carryMonths = overMix(mix, (u) => u === "multifamily" ? 6 : 10);
  const carry = Math.round(openSf * overMix(mix, (u) => opexPsf(u, s.econ, false)) * (carryMonths / 12));
  const leaseUp = Math.round(openSf * (tiPsf + lcPsf) * s.econ.costIdx) + carry;
  const landBasis = Math.round(s.holdings[bbl]?.costBasis ?? landValue(rec, s.econ));
  const buildCost = hardCost + softCost + demo + contingency + leaseUp;
  const costTotal = buildCost;
  const basisTotal0 = buildCost + landBasis;
  const ltcMax = constructionLtc(mix, s.econ.phase, s.econ.creditIdx ?? 1, lenderAppetite(s, CONSTRUCTION_LENDER));
  const wanted = Number.isFinite(ltcWanted) ? ltcWanted : ltcMax;
  const ltc = Math.max(0, Math.min(ltcMax, wanted));
  const ratePct = +(s.econ.indexRate + CONSTR_SPREAD).toFixed(2);
  const months = Math.min(54, 10 + Math.round(fl * 0.85));
  const rFrac = costTotal > 0 ? reserveFor(1, ratePct, months) : 0;
  const commitment = Math.round(ltc * costTotal / Math.max(0.35, 1 - ltc * rFrac));
  const interestReserve = Math.round(reserveFor(commitment, ratePct, months));
  const projectCost = costTotal + interestReserve;
  const asBuilt = asBuiltRec(rec, use, sf, fl);
  const rentPsf = marketRentPsfYr(asBuilt, s.econ, "good");
  const stabOcc = overMix(mix, (u) => u === "multifamily" ? 0.95 : 0.9);
  const opex = overMix(mix, (u) => opexPsf(u, s.econ, false));
  const recovery = overMix(mix, (u) => RECOVERY_RATE[u]);
  const basisTotal = basisTotal0 + interestReserve;
  const taxLoad = basisTotal * TAX_RATE * (1 - recovery);
  const stabNoi = sf * (rentPsf * stabOcc - opex * (1 - recovery * stabOcc)) - taxLoad;
  const exitCap = capRateFor(asBuilt, s.econ, "good");
  const yieldOnCost = basisTotal > 0 ? stabNoi / basisTotal * 100 : 0;
  const lenderNote = ltc === 0 ? "No construction lender will touch spec commercial in a recession. Pre-lease it, or fund the whole thing yourself." : yieldOnCost < exitCap + 0.75 ? `Yield on cost is ${yieldOnCost.toFixed(2)}% against a ${exitCap.toFixed(2)}% exit. That is not a development spread \u2014 it is a way to build a building for more than it is worth.` : void 0;
  return {
    use,
    mix,
    floors: fl,
    coverage: cov,
    contract,
    sf,
    far: +(sf / rec.lotArea).toFixed(1),
    farMax,
    hardCost,
    softCost,
    contingency,
    demo,
    leaseUp,
    costTotal,
    landBasis,
    basisTotal,
    ltc,
    ltcMax,
    commitment,
    interestReserve,
    ratePct,
    equity: projectCost - commitment,
    // Equity funds FIRST. The bank does not release a dollar until yours are
    // in the ground, which is why a development eats your balance sheet at the
    // start rather than in even slices.
    equityAtClose: Math.round((projectCost - commitment) * 0.55),
    months,
    yieldOnCost,
    exitCap,
    lenderNote
  };
}
function startDevelopment(s, parcels, bbl, use, floors, coverage = 0.6, contract = "gmp", ltcWanted, custom) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (!s.holdings[bbl]) return { s, err: "Buy the dirt first." };
  if (rec.class !== "land") return { s, err: "Clear the site first \u2014 demolish what's standing before you build." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  if (s.holdings[bbl].sale) return { s, err: "It's on the market \u2014 pull the listing before you put a crane on it." };
  if (s.landmarks?.[bbl] !== void 0) return { s, err: "It is landmarked \u2014 the envelope is what is already standing." };
  if (s.groundLeases?.[bbl]) return { s, err: "That site is ground-leased. Somebody else builds on it until the term runs out." };
  if (s.merged?.[bbl]) return { s, err: "That lot is part of an assemblage \u2014 build on the site, not the piece." };
  const plan = planDevelopment(s, parcels, bbl, use, floors, coverage, contract, ltcWanted, custom);
  if (!plan) return { s, err: "That's too small to be worth building \u2014 add floors or cover more of the lot." };
  const commitCap = plan.equity + Math.round(plan.costTotal * 0.06);
  const fundable = s.cash + locAvailable(s, parcels);
  if (fundable < commitCap) {
    return {
      s,
      err: `This job needs $${(plan.equity / 1e6).toFixed(2)}M of equity in total \u2014 $${(plan.equityAtClose / 1e6).toFixed(2)}M at close and the rest drawn as it goes up, plus a margin for change orders. You can fund $${(fundable / 1e6).toFixed(2)}M including the line. No lender closes without evidence you can finish it.`
    };
  }
  if (s.cash < plan.equityAtClose) {
    return { s, err: `The bank funds nothing until your equity is in the ground. That is $${(plan.equityAtClose / 1e6).toFixed(2)}M at close, of $${(plan.equity / 1e6).toFixed(2)}M total \u2014 you're short.` };
  }
  const next = clone2(s);
  next.cash -= plan.equityAtClose;
  logBooks(next, "dev", plan.equityAtClose);
  next.developments[bbl] = {
    bbl,
    use,
    mix: plan.mix,
    sf: plan.sf,
    floors: plan.floors,
    suites: custom?.suites,
    costTotal: plan.costTotal,
    hardCost: plan.hardCost,
    contract,
    contingency: plan.contingency,
    contingencyUsed: 0,
    commitment: plan.commitment,
    drawn: 0,
    loanBalance: 0,
    interestReserve: plan.interestReserve,
    reserveUsed: 0,
    leaseUpReserve: plan.leaseUp,
    equityBudget: plan.equity,
    equitySpent: plan.equityAtClose,
    // paid on day one, not yet applied against any work
    equityPrefunded: plan.equityAtClose,
    ratePct: plan.ratePct,
    startM: next.month,
    deliverM: next.month + plan.months,
    baseMonths: plan.months,
    signed: [],
    events: 0
  };
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Ground broken at ${rec.address}: ${plan.floors} floors, ${(plan.sf / 1e3).toFixed(0)}k sf of ${use === "mixed" ? "mixed-use" : use} at ${plan.far} FAR on a ${contract === "gmp" ? "guaranteed max price" : "cost-plus"} contract. $${(plan.costTotal / 1e6).toFixed(1)}M budget, ${(plan.ltc * 100).toFixed(0)}% funded, on spec. Delivery ${monthLabel(next.month + plan.months)}.`
  });
  return { s: next };
}
function takeoverDevelopment(s, parcels, bbl, half) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.lotArea || s.developments[bbl]) return;
  const use = half.use;
  const floors = Math.max(1, Math.round(half.floors));
  const coverage = Math.max(0.08, Math.min(0.9, half.sf / Math.max(1, rec.lotArea * floors)));
  const plan = planDevelopment(s, parcels, bbl, use, floors, coverage, "gmp");
  if (!plan) return;
  const done = Math.max(0, Math.min(0.95, half.progress));
  const remaining = Math.max(0, Math.round(half.costToComplete)) + plan.leaseUp;
  const months = Math.max(3, Math.round(plan.months * (1 - done)) + 2);
  const commitment = Math.round(remaining * Math.max(0.35, plan.ltc - 0.12));
  s.developments[bbl] = {
    bbl,
    use,
    mix: plan.mix,
    sf: half.sf,
    floors,
    costTotal: remaining,
    hardCost: Math.round(remaining * 0.8),
    contract: "gmp",
    contingency: Math.round(remaining * CONTINGENCY),
    contingencyUsed: 0,
    commitment,
    drawn: 0,
    loanBalance: 0,
    interestReserve: Math.round(commitment * 0.05),
    reserveUsed: 0,
    leaseUpReserve: plan.leaseUp,
    equityBudget: Math.max(0, remaining - commitment),
    equitySpent: 0,
    equityPrefunded: 0,
    // a takeover writes no cheque at close
    ratePct: +(s.econ.indexRate + 3.2).toFixed(2),
    startM: s.month,
    deliverM: s.month + months,
    baseMonths: months,
    signed: [],
    events: 0
  };
  s.cityJobs = (s.cityJobs ?? []).filter((j) => j.bbl !== bbl);
  s.news.unshift({
    q: s.month,
    kind: "deal",
    text: `You have taken over the job at ${rec.address} \u2014 ${(done * 100).toFixed(0)}% built, $${(remaining / 1e6).toFixed(1)}M to finish and open, delivery ${monthLabel(s.month + months)}. Somebody else paid for the hole in the ground.`
  });
}
function demolitionCost(rec, s) {
  return Math.round(Math.max(6e4, rec.bldgArea * 14 * s.econ.costIdx));
}
function demolish(s, parcels, bbl) {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  if (!h || !rec) return { s, err: "You don't own that." };
  if (rec.class === "land" || !rec.bldgArea) return { s, err: "There's nothing standing on it." };
  if (s.landmarks?.[bbl] !== void 0) return { s, err: "It is landmarked. Nobody knocks that down, including you." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  if (h.sale) return { s, err: "It's on the market \u2014 pull the listing first." };
  const leased = h.tenants.reduce((sum, t) => sum + t.sf, 0) + useSf(rec, "multifamily") * (h.occ ?? 0);
  if (leased / Math.max(1, rec.bldgArea) > 0.2) {
    return {
      s,
      err: "You can't demolish over occupied space. Stop letting it and wait the roll out, or buy the leases out \u2014 both are on the leasing desk."
    };
  }
  const cost = demolitionCost(rec, s);
  if (s.cash < cost) return { s, err: `Demolition runs $${(cost / 1e6).toFixed(2)}M \u2014 you're short.` };
  const next = clone2(s);
  next.cash -= cost;
  logBooks(next, "capex", cost);
  next.built[bbl] = { class: "land", bldgArea: 0, floors: 0, yearBuilt: 0 };
  const nh = next.holdings[bbl];
  nh.tenants = [];
  delete nh.occ;
  delete nh.makeReady;
  delete nh.deliveredM;
  nh.condition = "standard";
  nh.lastCapM = s.month;
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month,
    kind: "warn",
    text: `${rec.address} came down \u2014 $${(cost / 1e6).toFixed(2)}M to clear it. The site is dirt again.`
  });
  return { s: next };
}
function tickDevelopments(s, parcels) {
  for (const d of Object.values(s.developments)) {
    const rec = parcels[d.bbl];
    if (!rec || !s.holdings[d.bbl]) {
      delete s.developments[d.bbl];
      continue;
    }
    const span = Math.max(1, d.deliverM - d.startM);
    const t0 = Math.max(0, Math.min(1, (s.month - 1 - d.startM) / span));
    const t1 = Math.max(0, Math.min(1, (s.month - d.startM) / span));
    const curve = (t) => t * t * (3 - 2 * t);
    const spendShare = Math.max(0, curve(t1) - curve(t0));
    const buildSpend = Math.max(0, d.costTotal - (d.leaseUpReserve ?? 0));
    const spendNow = Math.round(buildSpend * spendShare);
    if (spendNow > 0) {
      const fromPre = Math.min(d.equityPrefunded ?? 0, spendNow);
      d.equityPrefunded = (d.equityPrefunded ?? 0) - fromPre;
      const rest = spendNow - fromPre;
      const equityLeft = Math.max(0, d.equityBudget - d.equitySpent);
      const fromEquity = Math.min(equityLeft, rest);
      const hardRoom = Math.max(0, d.commitment - d.interestReserve - (d.drawn - d.reserveUsed));
      const fromLoan = Math.min(hardRoom, rest - fromEquity);
      const unfunded = rest - fromEquity - fromLoan;
      d.equitySpent += fromEquity;
      d.drawn += fromLoan;
      d.loanBalance += fromLoan;
      s.cash -= fromEquity + unfunded;
      logBooks(s, "dev", fromEquity + unfunded);
      if (unfunded > 0) d.equitySpent += unfunded;
    }
    if (d.loanBalance > 0) {
      const interest = Math.round(d.loanBalance * d.ratePct / 100 / 12);
      if (d.reserveUsed + interest > d.interestReserve) {
        const extra = Math.round(reserveFor(d.commitment, d.ratePct, Math.max(3, d.deliverM - s.month)) * 0.5) + interest;
        d.interestReserve += extra;
        d.commitment += extra;
        s.news.unshift({
          q: s.month,
          kind: "info",
          text: `The schedule at ${rec.address} has run past its interest reserve. The lender topped it up \u2014 it goes on the balance the takeout has to cover, not on your cheque book.`
        });
      }
      d.reserveUsed += interest;
      d.loanBalance += interest;
      d.drawn += interest;
    }
    if (d.contract === "costplus" && s.month > d.startM) {
      const remaining = Math.max(0, d.hardCost * (1 - curve(t1)));
      const drift = s.econ.phase === "expansion" || s.econ.phase === "peak" ? rrange(s, 12e-4, 38e-4) : rrange(s, -1e-3, 16e-4);
      const escal = Math.round(remaining * drift);
      if (escal > 0) {
        d.costTotal += escal;
        d.hardCost += escal;
        d.equityBudget += escal;
      }
    }
    const progress = curve(t1);
    if (progress > 0.04 && progress < 0.97) {
      const roll = rng(s);
      const gmpShield = d.contract === "gmp" ? 0.35 : 1;
      if (roll < 0.028 * gmpShield) {
        const bump = rrange(s, 0.015, 0.07);
        const extra = Math.round(d.costTotal * bump);
        const fromContingency = Math.min(Math.max(0, d.contingency - d.contingencyUsed), extra);
        d.contingencyUsed += fromContingency;
        const overrun = extra - fromContingency;
        d.costTotal += overrun;
        d.hardCost += overrun;
        d.equityBudget += overrun;
        d.events++;
        s.news.unshift({
          q: s.month,
          kind: overrun > 0 ? "warn" : "info",
          text: overrun > 0 ? `Change orders at ${rec.address}: $${(extra / 1e6).toFixed(2)}M, of which $${(overrun / 1e6).toFixed(2)}M is past the contingency and lands on you.` : `Change orders at ${rec.address}: $${(extra / 1e6).toFixed(2)}M, absorbed by the contingency.`
        });
      } else if (roll < 0.055) {
        d.deliverM += 1 + Math.round(rng(s));
        d.events++;
        s.news.unshift({ q: s.month, kind: "warn", text: `Weather and inspections at ${rec.address} \u2014 delivery moves to ${monthLabel(d.deliverM)}.` });
      } else if (roll < 0.062) {
        const extra = Math.round(d.costTotal * rrange(s, 0.03, 0.09));
        const fromContingency = Math.min(Math.max(0, d.contingency - d.contingencyUsed), extra);
        d.contingencyUsed += fromContingency;
        const overrun = extra - fromContingency;
        d.costTotal += overrun;
        d.hardCost += overrun;
        d.equityBudget += overrun;
        d.deliverM += 2 + Math.round(rng(s) * 3);
        d.events++;
        s.news.unshift({
          q: s.month,
          kind: "warn",
          text: `A subcontractor at ${rec.address} defaulted. Re-tendering costs $${(extra / 1e6).toFixed(2)}M and pushes delivery to ${monthLabel(d.deliverM)}.`
        });
      }
    }
    if (s.month >= d.deliverM) deliver(s, parcels, d, rec);
  }
}
function tickConstructionLeasing(s, parcels) {
  for (const d of Object.values(s.developments)) {
    const rec = parcels[d.bbl];
    if (!rec) continue;
    const span = Math.max(1, d.deliverM - d.startM);
    const t = (s.month - d.startM) / span;
    if (t < 0.35) continue;
    if (!d.signed) d.signed = [];
    const takenSf = d.signed.reduce((a, x) => a + x.sf, 0);
    const leasable = Math.round(d.sf * specShare(d.mix ?? devMix(d.use)));
    const openSf = leasable - takenSf;
    if (openSf < 1500) continue;
    const lead = dominantOf(d.mix ?? devMix(d.use));
    const appetite = classAppetite(s, lead);
    const months = Math.max(1, d.deliverM - s.month);
    const near = clamp6(1.35 - months / 18, 0.35, 1.35);
    const p = clamp6(0.055 * appetite * near * (0.55 + demandLinear(rec.demandScore) / 130), 0, 0.42);
    if (rng(s) >= p) continue;
    const want = Math.round(openSf * rrange(s, 0.16, 0.5));
    if (want < 1500) continue;
    const discount = clamp6(1 - 0.16 * (months / Math.max(1, span)), 0.86, 0.99);
    d.signed.push({ sf: want, use: lead, discount, name: "" });
    s.news.unshift({
      q: s.month,
      kind: "deal",
      text: `Let before it opens: ${(want / 1e3).toFixed(0)}k sf at ${rec.address}, ${((1 - discount) * 100).toFixed(0)}% under market for taking delivery risk. ${((takenSf + want) / Math.max(1, leasable) * 100).toFixed(0)}% of the building is spoken for.`
    });
  }
}
function deliver(s, parcels, d, rec) {
  const dmix = d.mix ?? devMix(d.use);
  s.built[d.bbl] = { class: dominantOf(dmix), mix: dmix, bldgArea: d.sf, floors: d.floors, yearBuilt: 2e3 + Math.floor(s.month / 12), suites: d.suites };
  for (const [u, share] of Object.entries(dmix)) addStock(s.econ, u, d.sf * share);
  const h = s.holdings[d.bbl];
  h.condition = "good";
  h.lastCapM = s.month;
  h.tenants = [];
  h.deliveredM = s.month;
  if ((dmix.multifamily ?? 0) > 0) h.occ = 0.1;
  h.costBasis += d.costTotal;
  h.assessed = (h.assessed ?? h.costBasis - d.costTotal) + d.costTotal;
  const saved = Math.max(0, d.contingency - d.contingencyUsed);
  if (saved > 0) {
    s.cash += saved;
    logBooks(s, "dev", -saved);
  }
  const lease = d.leaseUpReserve ?? 0;
  if (lease > 0) {
    const room = Math.max(0, d.commitment - d.drawn);
    const advance = Math.min(lease, room);
    d.drawn += advance;
    d.loanBalance += advance;
    s.cash += lease;
    logBooks(s, "dev", -lease);
    s.news.unshift({
      q: s.month,
      kind: "info",
      text: `The lease-up reserve at ${rec.address} \u2014 $${(lease / 1e6).toFixed(2)}M \u2014 is released. That is what fits out the first tenants.`
    });
  }
  for (const sg of d.signed ?? []) {
    const built = resolveRec(parcels, s, d.bbl);
    if (built) genAnchorTenant(s, built, h, sg.sf, sg.discount, sg.use);
  }
  h.loan = {
    product: "cordage",
    floating: true,
    principal: d.loanBalance,
    balance: d.loanBalance,
    ratePct: +(s.econ.indexRate + 2.1).toFixed(2),
    spread: 2.1,
    // A THREE-YEAR CLOCK WAS TOO SHORT. Filling a building at this market's
    // pace takes longer than that, so every job arrived at its balloon still
    // half empty and un-refinanceable. A construction takeout is a three-plus
    // -two or a five-year in practice, and interest-only while it fills.
    ioUntilM: s.month + 24,
    amortYears: 30,
    maturityM: s.month + 60,
    monthlyPmt: Math.round(d.loanBalance * (s.econ.indexRate + 2.1) / 100 / 12),
    minDSCR: 1.05,
    maxLTV: 0.9,
    sweep: false,
    cleanQs: 0,
    originM: s.month,
    // A building that delivered empty cannot cover anything, and every lender
    // who writes construction paper knows it. The holiday runs three years —
    // long enough to fill it, short enough that failing to is fatal.
    holidayUntilM: s.month + 36,
    prepay: "open",
    prepayUntilM: s.month
  };
  delete s.developments[d.bbl];
  bumpLand(s, d.bbl, 1.06);
  const over = d.costTotal - (d.hardCost + Math.round(d.hardCost * SOFT_COST));
  void over;
  s.news.unshift({
    q: s.month,
    kind: "deal",
    text: `Delivered: ${(d.sf / 1e3).toFixed(0)}k sf of ${d.use} at ${rec.address}, ${d.events === 0 ? "on programme" : `after ${d.events} problem${d.events > 1 ? "s" : ""}`}, $${(d.costTotal / 1e6).toFixed(1)}M all in` + (saved > 0 ? `, with $${(saved / 1e6).toFixed(2)}M of contingency returned` : "") + `. The mini-perm matures ${monthLabel(s.month + 60)} \u2014 stabilise it before then.`
  });
}
var PROGRAMS = [
  { id: "lobby", label: "Lobby refresh", costPsf: 14, months: 3, blurb: "+4% new-lease rents, more LOIs" },
  { id: "systems", label: "Systems & HVAC", costPsf: 22, months: 6, blurb: "\u221215% operating costs" },
  { id: "facade", label: "Facade program", costPsf: 30, months: 6, blurb: "+8% new-lease rents" }
];
function programCost(rec, s, p) {
  return Math.round(rec.bldgArea * p.costPsf * s.econ.costIdx);
}
function startProgram(s, parcels, bbl, programId) {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  const p = PROGRAMS.find((x) => x.id === programId);
  if (!h || !rec || !p) return { s, err: "No such program." };
  if (rec.class === "land" || !rec.bldgArea) return { s, err: "Nothing to improve on a vacant lot." };
  if (h.program) return { s, err: "A capital program is already running." };
  if (h.programsDone?.[programId] !== void 0) return { s, err: "Already done here." };
  const cost = programCost(rec, s, p);
  if (s.cash < cost) return { s, err: `${p.label} costs $${(cost / 1e6).toFixed(2)}M \u2014 you're short.` };
  const next = clone2(s);
  next.cash -= cost;
  logBooks(next, "capex", cost);
  const nh = next.holdings[bbl];
  nh.program = { id: programId, untilM: next.month + p.months };
  next.news.unshift({ q: next.month, kind: "info", text: `${p.label} underway at ${rec.address} ($${(cost / 1e6).toFixed(2)}M).` });
  return { s: next };
}
function tickPrograms(s, parcels) {
  for (const h of Object.values(s.holdings)) {
    if (h.program && s.month >= h.program.untilM) {
      h.programsDone = { ...h.programsDone ?? {}, [h.program.id]: s.month };
      const rec = resolveRec(parcels, s, h.bbl);
      const p = PROGRAMS.find((x) => x.id === h.program.id);
      if (rec && p) s.news.unshift({ q: s.month, kind: "info", text: `${p.label} complete at ${rec.address}.` });
      delete h.program;
    }
  }
}
function setStance(s, bbl, stance) {
  const next = clone2(s);
  if (next.holdings[bbl]) next.holdings[bbl].stance = stance;
  return next;
}
var START_RATE = {
  expansion: 0.055,
  peak: 0.036,
  recovery: 0.026,
  recession: 5e-3
};
function useForZone(zone, demand, r) {
  if (zone.startsWith("M")) return "industrial";
  if (zone.startsWith("R")) return "multifamily";
  if (demand > 70) return r < 0.55 ? "office" : r < 0.85 ? "mixed" : "retail";
  if (demand > 45) return r < 0.4 ? "mixed" : r < 0.8 ? "multifamily" : "retail";
  return r < 0.7 ? "multifamily" : "retail";
}
var clamp6 = (v, a, b) => Math.max(a, Math.min(b, v));
function classAppetite(s, k) {
  const e = s.econ;
  const vac = e.cityVac?.[k] ?? NATURAL_VAC[k];
  const gap = vac - NATURAL_VAC[k];
  const stk = e.stock?.[k] ?? CITY_STOCK[k];
  const coming = (e.pipeline?.[k] ?? 0) / Math.max(1, stk);
  const tight = clamp6(1 - gap * 13 - coming * 5, 0, 2.1);
  return tight * clamp6(e.creditIdx ?? 1, 0.25, 1.25);
}
function tickCityGrowth(s, parcels, bbls, adjacency) {
  if (!s.cityJobs) s.cityJobs = [];
  const still = [];
  for (const j of s.cityJobs) {
    if (j.orphaned) {
      if (!s.built[j.bbl] && !s.holdings[j.bbl]) still.push(j);
      continue;
    }
    if (s.month < j.deliverM) {
      still.push(j);
      continue;
    }
    const rec = parcels[j.bbl];
    if (!rec || s.holdings[j.bbl] || s.built[j.bbl]) continue;
    const cmix = devMix(j.use);
    s.built[j.bbl] = {
      class: dominantOf(cmix),
      mix: cmix,
      bldgArea: j.sf,
      floors: j.floors,
      yearBuilt: 2e3 + Math.floor(s.month / 12)
    };
    s.cityBuilt.push(j.bbl);
    if (j.firmId) jobDelivered(s, parcels, j.bbl, j.firmId, j.cost ?? 0);
    bumpLand(s, j.bbl, 1.05);
    for (const nb of adjacency?.[j.bbl] ?? []) bumpLand(s, nb, 1.03);
    if (!j.firmId && rng(s) < 0.55) {
      s.news.unshift({
        q: s.month,
        kind: "info",
        text: j.floors >= 8 ? `A ${j.floors}-story ${j.use} building opened at ${rec.address}.` : `New ${j.use} construction delivered at ${rec.address}.`
      });
    }
  }
  s.cityJobs = still;
  const rate = START_RATE[s.econ.phase] ?? 0.1;
  const named = (s.cityJobs ?? []).filter((j) => j.startM === s.month && j.firmId).length;
  s.startDebt = Math.min(24, (s.startDebt ?? 0) + named);
  let n = Math.floor(rate) + (rng(s) < rate % 1 ? 1 : 0);
  const paid = Math.min(n, s.startDebt ?? 0);
  s.startDebt = (s.startDebt ?? 0) - paid;
  n -= paid;
  const maturity = Math.min(1, s.month / 780);
  while (n-- > 0) {
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 36; i++) {
      const bbl2 = bbls[Math.floor(rng(s) * bbls.length)];
      if (s.holdings[bbl2] || s.built[bbl2] || s.developments[bbl2]) continue;
      if (s.cityJobs.some((j) => j.bbl === bbl2)) continue;
      if (ownerOf(s, bbl2)) continue;
      const rec2 = resolveRec(parcels, s, bbl2);
      if (!rec2 || rec2.class !== "land" || rec2.lotArea < 1500) continue;
      const score = demandNow(s, rec2) + rng(s) * 25;
      if (score > bestScore) {
        bestScore = score;
        best = { bbl: bbl2, rec: rec2 };
      }
    }
    if (!best) continue;
    const { bbl, rec } = best;
    const dNow = demandNow(s, rec);
    let use = useForZone(rec.zoneDist, dNow, rng(s));
    if (use === "retail" && retailWantsMixed(rec)) use = "mixed";
    const cmix = devMix(use);
    const lead = dominantOf(cmix);
    if (rng(s) > Math.min(1, classAppetite(s, lead) * 0.85)) continue;
    const farMax = farMaxFor(rec);
    const frac = Math.min(0.95, 0.22 + 0.45 * maturity + 0.3 * (dNow / 100) * maturity + rng(s) * 0.15);
    let sf = Math.max(3e3, Math.round(rec.lotArea * farMax * frac / 100) * 100);
    let floors = Math.max(1, Math.round(sf / (rec.lotArea * 0.62)));
    const cap = MAX_FLOORS_BY_USE[use];
    if (cap !== void 0 && floors > cap) {
      floors = cap;
      sf = Math.max(3e3, Math.round(rec.lotArea * 0.62 * floors / 100) * 100);
    }
    const [bLo, bHi] = BUILD_MONTHS[lead];
    const months = Math.round(bLo + rng(s) * (bHi - bLo));
    const deliverM = s.month + months;
    s.cityJobs.push({ bbl, use, sf, floors, startM: s.month, deliverM });
    if (!s.econ.cohorts) s.econ.cohorts = { office: [], retail: [], multifamily: [], industrial: [] };
    for (const [u, share] of Object.entries(cmix)) {
      const usf = Math.round(sf * share);
      if (usf > 0) s.econ.cohorts[u].push({ m: deliverM, sf: usf });
    }
    const claimed = claimJob(s, parcels, bbl, use, sf, floors, deliverM);
    if (!claimed && rng(s) < 0.4) {
      s.news.unshift({
        q: s.month,
        kind: "info",
        text: `Ground broken at ${rec.address} \u2014 ${(sf / 1e3).toFixed(0)}k sf of ${use}, due ${monthLabel(deliverM)}.`
      });
    }
  }
}
function bumpLand(s, bbl, mult) {
  s.landAdj[bbl] = Math.min(4, (s.landAdj[bbl] ?? 1) * mult);
}
var SUITE_BOUNDS = {
  // 2,000 sf is the floor for any commercial tenancy — see COMMERCIAL_SUITE_MIN
  // in leasing.ts. Below it you are describing a kiosk or a serviced desk.
  office: { min: 2e3, max: 6e4, typical: 4500 },
  retail: { min: 2e3, max: 3e4, typical: 3200 },
  industrial: { min: 5e3, max: 2e5, typical: 25e3 },
  multifamily: { min: 450, max: 2200, typical: 850 }
};
function unitRange(useSfArea, use) {
  const b = SUITE_BOUNDS[use];
  const sfArea = Math.max(0, useSfArea);
  return {
    min: Math.max(1, Math.floor(sfArea / b.max)),
    max: Math.max(1, Math.floor(sfArea / b.min)),
    typical: Math.max(1, Math.round(sfArea / b.typical))
  };
}
function suiteSfForUnits(useSfArea, use, units) {
  const b = SUITE_BOUNDS[use];
  const r = unitRange(useSfArea, use);
  const n = Math.max(r.min, Math.min(r.max, Math.round(units)));
  return Math.max(b.min, Math.min(b.max, Math.round(useSfArea / Math.max(1, n))));
}

// src/engine/rivals.ts
var FIRMS = [
  { name: "Calloway & Reed", style: "family", equity: 7e6, ltv: 0.32 },
  { name: "Harbor Point Partners", style: "core", equity: 9e6, ltv: 0.52 },
  { name: "Meridian Yield Group", style: "opportunistic", equity: 55e5, ltv: 0.71 },
  { name: "Alden Development Co.", style: "developer", equity: 8e6, ltv: 0.66 },
  { name: "Wentworth Trust", style: "core", equity: 1e7, ltv: 0.41 },
  { name: "Kestrel Capital", style: "opportunistic", equity: 4e6, ltv: 0.78 },
  { name: "Thorne & Boyle", style: "family", equity: 6e6, ltv: 0.28 },
  { name: "Longwharf Realty", style: "developer", equity: 65e5, ltv: 0.69 },
  { name: "Pell Street Holdings", style: "opportunistic", equity: 45e5, ltv: 0.82 },
  { name: "Granite Mutual", style: "core", equity: 1e7, ltv: 0.44 },
  { name: "Wrenfield Brothers", style: "family", equity: 5e6, ltv: 0.35 },
  { name: "Tidewater Development", style: "developer", equity: 85e5, ltv: 0.72 }
];
var STYLE = {
  // sold their soul to nobody; buys quality, holds forever, sleeps at night
  family: { appetite: 0.3, procyclical: 0.5, maxLtv: 0.5, cashOut: 0, classes: null, patience: 1.02 },
  // institutional money: steady, disciplined, buys stabilised income
  core: { appetite: 0.75, procyclical: 1, maxLtv: 0.65, cashOut: 0.2, classes: ["office", "multifamily"], patience: 1.06 },
  // the ones who win the last three years of every cycle and lose the next one
  opportunistic: { appetite: 1.25, procyclical: 1.9, maxLtv: 0.88, cashOut: 0.85, classes: null, patience: 1.16 },
  // buys dirt and puts buildings on it; the city's growth is partly theirs
  developer: { appetite: 0.85, procyclical: 1.5, maxLtv: 0.78, cashOut: 0.55, classes: ["land", "industrial", "retail"], patience: 1.1 }
};
var RATE_SPREAD = 1.9;
var BUILD_APPETITE = {
  developer: 1,
  opportunistic: 0.3,
  core: 0.06,
  family: 0
};
var CONSTR_SPREAD_R = 2.6;
function transferDeed(s, bbl, to, price) {
  for (const r of s.rivals ?? []) {
    if (r === to || !r.bbls.includes(bbl)) continue;
    r.bbls = r.bbls.filter((b) => b !== bbl);
    if (price > 0) {
      const relief = Math.min(r.debt, Math.round(price * r.targetLtv));
      r.debt -= relief;
      r.cash += price - relief;
    }
  }
  if (!to.bbls.includes(bbl)) to.bbls.push(bbl);
}
function jobBudget(s, use, sf, floors) {
  const mix = devMix(use);
  let psf = 0, w = 0;
  for (const u of Object.keys(mix)) {
    const sh = mix[u] ?? 0;
    psf += HARD_COST_PSF[u] * sh;
    w += sh;
  }
  psf = w > 0 ? psf / w : HARD_COST_PSF.office;
  const heightPrem = floors > 30 ? 1.28 : floors > 18 ? 1.18 : floors > 8 ? 1.07 : 1;
  const hard = sf * psf * s.econ.costIdx * heightPrem * 1.04;
  return Math.round(hard * (1 + SOFT_COST) * 1.06);
}
function claimJob(s, parcels, bbl, use, sf, floors, deliverM) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return null;
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  const phaseMult = s.econ.phase === "peak" ? 1.5 : s.econ.phase === "expansion" ? 1.2 : s.econ.phase === "recovery" ? 0.6 : 0.15;
  const cost = jobBudget(s, use, sf, floors);
  const land = Math.round(landValue(rec, s.econ) * rrange(s, 1.02, 1.18));
  const ltc = Math.max(0.4, Math.min(0.7, 0.7 * ci));
  const equity = Math.round(cost * (1 - ltc)) + land;
  const runners = livingRivals(s).filter((r) => {
    const want = BUILD_APPETITE[r.style];
    if (want <= 0) return false;
    const live = (s.cityJobs ?? []).filter((j) => j.firmId === r.id).length;
    if (live >= (r.style === "developer" ? 2 : 1)) return false;
    if (cost > (r.aum ?? 0) * 0.75 + r.cash * 4) return false;
    const dayOne = land + Math.round(cost * (1 - ltc) * 0.45);
    if (r.cash < dayOne + Math.max(1e6, r.cash * 0.06)) return false;
    return rng(s) < 0.5 * want * phaseMult * ci;
  });
  if (!runners.length) return null;
  let best = runners[0], bestW = -Infinity;
  for (const r of runners) {
    const w = BUILD_APPETITE[r.style] * (r.cash / Math.max(1, equity)) * (0.6 + rng(s) * 0.8);
    if (w > bestW) {
      bestW = w;
      best = r;
    }
  }
  best.cash -= land;
  best.basis = Math.round((best.basis ?? 0) + land);
  transferDeed(s, bbl, best, land);
  const job = (s.cityJobs ?? []).find((j) => j.bbl === bbl);
  if (job) {
    job.firmId = best.id;
    job.cost = cost;
    job.spent = 0;
    job.equityLeft = Math.round(cost * (1 - ltc));
    job.debt = 0;
    job.ratePct = +(s.econ.indexRate + CONSTR_SPREAD_R).toFixed(2);
  }
  s.news.unshift({
    q: s.month,
    kind: "event",
    text: `${best.name} has broken ground at ${rec.address} \u2014 ${(sf / 1e3).toFixed(0)}k sf of ${use}, $${(cost / 1e6).toFixed(1)}M, due ${2e3 + Math.floor(deliverM / 12)}. That space is coming whether you want it or not.`
  });
  return best;
}
function fundJobs(s) {
  for (const j of s.cityJobs ?? []) {
    if (!j.firmId || j.orphaned) continue;
    const r = s.rivals.find((x) => x.id === j.firmId);
    if (!r || r.failedM !== void 0) {
      j.orphaned = true;
      continue;
    }
    const span = Math.max(1, j.deliverM - j.startM);
    const t1 = Math.min(1, (s.month - j.startM + 1) / span);
    const t0 = Math.min(1, (s.month - j.startM) / span);
    const curve = (t) => t * t * (3 - 2 * t);
    const spend = Math.round((j.cost ?? 0) * Math.max(0, curve(t1) - curve(t0)));
    if (spend > 0) {
      const fromEquity = Math.min(spend, Math.max(0, j.equityLeft ?? 0));
      r.cash -= fromEquity;
      j.equityLeft = Math.max(0, (j.equityLeft ?? 0) - fromEquity);
      const fromDebt = spend - fromEquity;
      j.debt = (j.debt ?? 0) + fromDebt;
      r.debt += fromDebt;
      j.spent = (j.spent ?? 0) + spend;
    }
    const cap = Math.round((j.debt ?? 0) * (j.ratePct ?? 8) / 100 / 12);
    if (cap > 0) {
      j.debt = (j.debt ?? 0) + cap;
      r.debt += cap;
    }
  }
}
function jobDelivered(s, parcels, bbl, firmId, cost) {
  const r = s.rivals.find((x) => x.id === firmId);
  if (!r) return;
  transferDeed(s, bbl, r, 0);
  r.basis = Math.round((r.basis ?? 0) + cost);
  const rec = resolveRec(parcels, s, bbl);
  if (rec && rng(s) < 0.7) {
    s.news.unshift({
      q: s.month,
      kind: "event",
      text: `${r.name} has opened ${rec.address}. It is empty today and it is competing with you tomorrow.`
    });
  }
}
function orphanToTape(s, parcels) {
  for (const j of s.cityJobs ?? []) {
    if (!j.orphaned) continue;
    if (j.listedM !== void 0 && s.month - j.listedM < 24) continue;
    const rec = resolveRec(parcels, s, j.bbl);
    if (!rec || s.holdings[j.bbl] || s.listings.some((l) => l.bbl === j.bbl)) continue;
    const sunk = j.spent ?? 0;
    const progress = Math.min(0.95, sunk / Math.max(1, j.cost ?? 1));
    const stale = Math.max(0.45, 1 - (j.listedM === void 0 ? 0 : (s.month - j.listedM) / 90));
    const ask = Math.round((landValue(rec, s.econ) + sunk * rrange(s, 0.45, 0.7) * stale) / 1e3) * 1e3;
    if (ask <= 0) continue;
    const relist = j.listedM !== void 0;
    j.listedM = s.month;
    s.listings.push({
      bbl: j.bbl,
      ask,
      listedM: s.month,
      expiresM: s.month + Math.round(rrange(s, 8, 16)),
      distress: true,
      halfBuilt: { use: j.use, sf: j.sf, floors: j.floors, progress, costToComplete: Math.max(0, (j.cost ?? 0) - sunk) }
    });
    s.news.unshift({
      q: s.month,
      kind: "event",
      text: relist ? `The stalled frame at ${rec.address} is back on the tape at $${(ask / 1e6).toFixed(2)}M. Nobody wanted it last time and the steel has not got any newer.` : `The receiver is clearing a half-finished building at ${rec.address} \u2014 ${(progress * 100).toFixed(0)}% complete, $${(ask / 1e6).toFixed(2)}M for the site and the frame. Somebody else's problem is on the market.`
    });
  }
}
function initRivals(s, parcels, bbls) {
  const out = [];
  const built = bbls.filter((b) => {
    const r = parcels[b];
    return r && r.class !== "land" && r.bldgArea > 0;
  });
  const taken = /* @__PURE__ */ new Set();
  FIRMS.forEach((f, i) => {
    const r = {
      id: `r${i}`,
      name: f.name,
      style: f.style,
      // The reserve comes OUT of what they raised, it is not conjured on top
      // of it. A firm holding back a tenth of its fund has a tenth less to buy
      // with, exactly like you do.
      cash: 0,
      bbls: [],
      debt: 0,
      targetLtv: f.ltv,
      bornM: 0,
      basis: 0
    };
    const reserveShare = rrange(s, 0.06, 0.16);
    r.cash = Math.round(f.equity * reserveShare);
    let spend = f.equity - r.cash;
    let guard = 0;
    while (spend > 0 && guard++ < 3e3) {
      const bbl = built[Math.floor(rng(s) * built.length)];
      if (!bbl || taken.has(bbl)) continue;
      const rec = parcels[bbl];
      const v = assetValue(rec, s.econ, initialCondition(rec));
      if (v <= 0) continue;
      const styleOk = STYLE[f.style].classes === null || STYLE[f.style].classes.includes(rec.class);
      if (!styleOk && rng(s) < 0.75) continue;
      const equityIn = v * (1 - f.ltv);
      if (equityIn > spend) {
        if (spend < f.equity * 0.08) break;
        else continue;
      }
      taken.add(bbl);
      r.bbls.push(bbl);
      r.debt += Math.round(v * f.ltv);
      r.basis = Math.round((r.basis ?? 0) + v);
      spend -= equityIn;
    }
    out.push(r);
  });
  return out;
}
function rivalCondition(r) {
  const c = r.condIdx ?? 0.8;
  return c > 0.78 ? "good" : c > 0.52 ? "standard" : "worn";
}
var GRADES = ["worn", "standard", "good"];
function assetGrade(r, rec) {
  const base = initialCondition(rec);
  const c = r.condIdx ?? 0.8;
  const notch = c > 0.82 ? 1 : c > 0.5 ? 0 : -1;
  const i = Math.max(0, Math.min(2, GRADES.indexOf(base) + notch));
  return GRADES[i];
}
function markRival(s, parcels, r) {
  let aum = 0, noi = 0;
  const bookMkt = Math.max(0.35, r.mktOcc ?? 0.88);
  for (const bbl of r.bbls) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const cond = assetGrade(r, rec);
    const v = assetValue(rec, s.econ, cond);
    if (rec.class === "land" || !rec.bldgArea) {
      aum += v;
      noi += noiAfterTaxYr(rec, s.econ, cond, v);
      continue;
    }
    const ratio = Math.max(0.35, Math.min(1.2, (r.occ ?? bookMkt) / bookMkt));
    aum += v * (0.42 + 0.58 * ratio);
    noi += noiAfterTaxYr(rec, s.econ, cond, v) * ratio;
  }
  return { aum, noiYr: noi, ltv: aum > 0 ? r.debt / aum : r.debt > 0 ? 9 : 0 };
}
var CARE = {
  family: { lease: 0.9, capex: 1.15 },
  core: { lease: 1.15, capex: 1.2 },
  opportunistic: { lease: 0.85, capex: 0.45 },
  developer: { lease: 1, capex: 0.8 }
};
function tickAssetManagement(s, parcels, r) {
  if (!r.bbls.length) {
    r.occ = void 0;
    return;
  }
  const care = CARE[r.style];
  let target = 0, n = 0;
  for (const bbl of r.bbls) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    target += occupancy(rec, s.econ);
    n++;
  }
  if (!n) {
    r.occ = void 0;
    return;
  }
  r.mktOcc = target / n;
  target = r.mktOcc * (0.965 + 0.05 * care.lease);
  if (r.occ === void 0) r.occ = target;
  r.occ += (target - r.occ) * 0.055 + rrange(s, -4e-3, 4e-3);
  if (rng(s) < 6e-3 / Math.max(1, Math.sqrt(r.bbls.length) / 2)) {
    r.occ -= rrange(s, 0.05, 0.14);
    if (rng(s) < 0.35) {
      s.news.unshift({
        q: s.month,
        kind: "event",
        text: `${r.name} has lost a major tenant. Their book is running at ${(Math.max(0, r.occ) * 100).toFixed(0)}% \u2014 somebody in this town is about to have space to fill.`
      });
    }
  }
  r.occ = Math.max(0.2, Math.min(0.99, r.occ));
  if (r.condIdx === void 0) r.condIdx = 0.72;
  r.condIdx -= 24e-4 * (s.econ.phase === "recession" ? 1.25 : 1);
  const aum = r.aum ?? 0;
  const want = Math.round(3e-3 * aum * care.capex / 12);
  if (want > 0 && r.cash > want * 6 && !r.stressMs) {
    r.cash -= want;
    r.capexYr = (r.capexYr ?? 0) + want;
    r.condIdx += 26e-4 * care.capex;
  }
  r.condIdx = Math.max(0.3, Math.min(0.97, r.condIdx));
  if (s.month % 12 === 0) r.capexYr = 0;
}
function livingRivals(s) {
  return (s.rivals ?? []).filter((r) => r.failedM === void 0);
}
function marketAppetite(s) {
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  let a = 0, n = 0;
  for (const r of livingRivals(s)) {
    const st = STYLE[r.style];
    const dry = Math.max(0, Math.min(1.5, r.cash / Math.max(1, 0.04 * Math.max(1, r.aum ?? r.debt))));
    a += st.appetite * (1 + st.procyclical * (ci - 1)) * Math.min(1.15, 0.2 + dry);
    n++;
  }
  if (!n) return Math.max(0.25, ci);
  return Math.max(0.2, a / n / NEUTRAL_APPETITE);
}
var NEUTRAL_APPETITE = 0.43;
function ownerOf(s, bbl) {
  for (const r of s.rivals ?? []) if (r.bbls.includes(bbl)) return r;
  return null;
}
var NEW_FIRMS = [
  { name: "Northgate Partners", style: "opportunistic" },
  { name: "Sable & Hale", style: "core" },
  { name: "Drydock Holdings", style: "developer" },
  { name: "Ostrander Group", style: "opportunistic" },
  { name: "Bellweather Estates", style: "family" },
  { name: "Quarry Lane Capital", style: "core" },
  { name: "Alden Municipal Pension", style: "core" },
  { name: "Fen & Marrow", style: "opportunistic" },
  { name: "Corbin Whitlock", style: "opportunistic" },
  { name: "Saltmarsh Trust", style: "family" },
  { name: "Ironbound Development", style: "developer" },
  { name: "Halyard Investors", style: "core" },
  { name: "Verity Street Capital", style: "opportunistic" },
  { name: "Merrow & Sons", style: "family" },
  { name: "Pilotage Partners", style: "developer" },
  { name: "Consolidated Wharf Co.", style: "core" }
];
var MIN_FIRMS = 9;
function maybeNewFirm(s, ci) {
  const living = livingRivals(s);
  if (living.length >= MIN_FIRMS) return;
  if (ci < 0.88 || rng(s) > 0.045) return;
  const used = new Set((s.rivals ?? []).map((r) => r.name));
  const pool = NEW_FIRMS.filter((f2) => !used.has(f2.name));
  if (!pool.length) return;
  const f = pool[Math.floor(rng(s) * pool.length)];
  const equity = Math.round(rrange(s, 4e6, 1e7));
  const ltv2 = STYLE[f.style].maxLtv * rrange(s, 0.68, 0.88);
  s.rivals.push({
    id: `r${s.rivals.length}`,
    name: f.name,
    style: f.style,
    cash: equity,
    debt: 0,
    bbls: [],
    targetLtv: +ltv2.toFixed(2),
    bornM: s.month
  });
  s.news.unshift({
    q: s.month,
    kind: "event",
    text: `${f.name} has raised $${(equity / 1e6).toFixed(0)}M and is looking for buildings. There is competition on the tape again.`
  });
}
function gainsTax(r, price) {
  const basis = r.basis ?? 0;
  const n = Math.max(1, r.bbls.length);
  const share = Math.min(basis, basis / n);
  const gain = Math.max(0, price - share);
  r.basis = Math.max(0, Math.round(basis - share));
  const tax = Math.round(gain * 0.25);
  r.taxPaid = (r.taxPaid ?? 0) + tax;
  return tax;
}
function rescueOrphan(s, parcels, ci) {
  const stalled = (s.cityJobs ?? []).filter((j2) => j2.orphaned && j2.listedM !== void 0 && s.month - j2.listedM >= 6);
  if (!stalled.length) return;
  const j = stalled[Math.floor(rng(s) * stalled.length)];
  if (s.holdings[j.bbl]) return;
  const listing = s.listings.find((l) => l.bbl === j.bbl);
  const price = listing?.ask ?? 0;
  if (price <= 0) return;
  const toFinish = Math.max(0, (j.cost ?? 0) - (j.spent ?? 0));
  const taker = livingRivals(s).find((r) => BUILD_APPETITE[r.style] >= 0.3 && r.cash > price + toFinish * 0.4 + 2e6 && rng(s) < 0.1 * BUILD_APPETITE[r.style] * ci);
  if (!taker) return;
  taker.cash -= price;
  taker.basis = Math.round((taker.basis ?? 0) + price);
  transferDeed(s, j.bbl, taker, price);
  j.orphaned = false;
  j.firmId = taker.id;
  j.equityLeft = Math.round(toFinish * 0.45);
  j.cost = (j.spent ?? 0) + toFinish;
  j.ratePct = +(s.econ.indexRate + CONSTR_SPREAD_R + 0.6).toFixed(2);
  j.deliverM = s.month + Math.max(6, Math.round((j.deliverM - j.startM) * 0.5));
  s.listings = s.listings.filter((l) => l.bbl !== j.bbl);
  const rec = resolveRec(parcels, s, j.bbl);
  s.news.unshift({
    q: s.month,
    kind: "event",
    text: `${taker.name} has taken out the stalled building at ${rec?.address ?? j.bbl} for $${(price / 1e6).toFixed(2)}M. The cranes are back and that space is coming after all.`
  });
}
function startOwnJob(s, parcels, r, ci) {
  if (BUILD_APPETITE[r.style] <= 0) return;
  const live = (s.cityJobs ?? []).filter((j) => j.firmId === r.id).length;
  if (live >= (r.style === "developer" ? 2 : 1)) return;
  const phaseMult = s.econ.phase === "peak" ? 1.4 : s.econ.phase === "expansion" ? 1.2 : s.econ.phase === "recovery" ? 0.6 : 0.12;
  if (rng(s) >= 0.011 * BUILD_APPETITE[r.style] * phaseMult * ci) return;
  let best = null, bestScore = -1;
  for (const bbl2 of r.bbls) {
    if ((s.cityJobs ?? []).some((j) => j.bbl === bbl2)) continue;
    const rec2 = resolveRec(parcels, s, bbl2);
    if (!rec2 || rec2.class !== "land" || rec2.lotArea < 2500) continue;
    const score = rec2.demandScore + rng(s) * 20;
    if (score > bestScore) {
      bestScore = score;
      best = { bbl: bbl2, rec: rec2 };
    }
  }
  if (!best) return;
  const { bbl, rec } = best;
  let use = useForZone(rec.zoneDist, rec.demandScore, rng(s));
  if (use === "retail" && retailWantsMixed(rec)) use = "mixed";
  const lead = dominantOf(devMix(use));
  const farMax = farMaxFor(rec);
  const frac = Math.min(0.95, 0.4 + rng(s) * 0.45);
  let sf = Math.max(3e3, Math.round(rec.lotArea * farMax * frac / 100) * 100);
  let floors = Math.max(1, Math.round(sf / (rec.lotArea * 0.62)));
  const cap = MAX_FLOORS_BY_USE[use];
  if (cap !== void 0 && floors > cap) {
    floors = cap;
    sf = Math.max(3e3, Math.round(rec.lotArea * 0.62 * floors / 100) * 100);
  }
  const cost = jobBudget(s, use, sf, floors);
  if (cost > (r.aum ?? 0) * 0.75 + r.cash * 4) return;
  const ltc = Math.max(0.4, Math.min(0.7, 0.7 * ci));
  if (r.cash < Math.round(cost * (1 - ltc) * 0.45) + Math.max(1e6, r.cash * 0.06)) return;
  const [bLo, bHi] = BUILD_MONTHS[lead];
  const months = Math.round(bLo + rng(s) * (bHi - bLo));
  const deliverM = s.month + months;
  if (!s.cityJobs) s.cityJobs = [];
  s.cityJobs.push({
    bbl,
    use,
    sf,
    floors,
    startM: s.month,
    deliverM,
    firmId: r.id,
    cost,
    spent: 0,
    equityLeft: Math.round(cost * (1 - ltc)),
    debt: 0,
    ratePct: +(s.econ.indexRate + CONSTR_SPREAD_R).toFixed(2)
  });
  if (!s.econ.cohorts) s.econ.cohorts = { office: [], retail: [], multifamily: [], industrial: [] };
  for (const [u, share] of Object.entries(devMix(use))) {
    const usf = Math.round(sf * share);
    if (usf > 0) s.econ.cohorts[u].push({ m: deliverM, sf: usf });
  }
  s.news.unshift({
    q: s.month,
    kind: "event",
    text: `${r.name} is building on their own land at ${rec.address} \u2014 ${(sf / 1e3).toFixed(0)}k sf of ${use}, $${(cost / 1e6).toFixed(1)}M. They have been sitting on that corner waiting for this market.`
  });
}
function tickRivals(s, parcels) {
  if (!s.rivals?.length) return;
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  const rate = s.econ.indexRate + RATE_SPREAD;
  maybeNewFirm(s, ci);
  fundJobs(s);
  orphanToTape(s, parcels);
  rescueOrphan(s, parcels, ci);
  for (const r of s.rivals) {
    if (r.failedM !== void 0) {
      if (!r.bbls.length) continue;
      let release = 1 + Math.floor(rng(s) * 2);
      while (release-- > 0 && r.bbls.length) {
        const bbl = r.bbls[Math.floor(rng(s) * r.bbls.length)];
        r.bbls = r.bbls.filter((b) => b !== bbl);
        if (s.holdings[bbl] || s.listings.some((l) => l.bbl === bbl)) continue;
        const rec = resolveRec(parcels, s, bbl);
        if (!rec) continue;
        const v = assetValue(rec, s.econ, initialCondition(rec));
        s.listings.push({
          // A receiver takes a haircut; a receiver does not give buildings
          // away. The bottom of this band is the bottom of the whole game's
          // discount range — see ASK_FLOOR in sim.ts.
          bbl,
          ask: Math.round(v * rrange(s, 0.72, 0.88) / 1e3) * 1e3,
          listedM: s.month,
          expiresM: s.month + Math.round(rrange(s, 6, 12)),
          distress: true
        });
      }
      continue;
    }
    const st = STYLE[r.style];
    tickAssetManagement(s, parcels, r);
    startOwnJob(s, parcels, r, ci);
    const { aum, noiYr: noiYr2, ltv: ltv2 } = markRival(s, parcels, r);
    r.aum = Math.round(aum);
    const interest = r.debt * rate / 100 / 12;
    const amort = r.debt > 0 ? r.debt / (30 * 12) : 0;
    const onDeposit = r.cash > 0 ? r.cash * CASH_APY / 12 : 0;
    r.cash += Math.round(noiYr2 / 12 - interest - amort + onDeposit);
    r.debt = Math.max(0, Math.round(r.debt - amort));
    if (r.bbls.length > 0) {
      r.cash -= Math.round((6e4 * s.econ.costIdx + 28e-4 * aum) / 12);
    }
    if (s.month > 0 && s.month % 12 === 0) {
      const depr = (r.basis ?? aum) * 0.7 / 33;
      const taxable = noiYr2 - interest * 12 - depr;
      if (taxable > 0) {
        const tax = Math.round(taxable * 0.25);
        r.cash -= tax;
        r.taxPaid = (r.taxPaid ?? 0) + tax;
      }
    }
    const reserve = Math.min(
      r.style === "developer" ? 45e6 : 3e7,
      Math.max(2e6, aum * (r.style === "developer" ? 0.16 : r.style === "family" ? 0.09 : r.style === "core" ? 0.06 : 0.045))
    );
    const building = (s.cityJobs ?? []).some((j) => j.firmId === r.id && !j.orphaned);
    if (r.cash > reserve && !r.stressMs && !building) {
      const out = Math.round((r.cash - reserve) * 0.35);
      r.cash -= out;
      r.distributed = (r.distributed ?? 0) + out;
    }
    if (st.cashOut > 0 && ci > 1.02 && ltv2 < st.maxLtv - 0.06 && rng(s) < 0.06 * st.cashOut) {
      const room = Math.round((st.maxLtv - 0.04 - ltv2) * aum);
      if (room > 1e6) {
        r.debt += room;
        r.cash += room;
      }
    }
    const hot = s.econ.phase === "peak" || s.econ.phase === "expansion";
    if (r.bbls.length > 6 && !r.stressMs && rng(s) < (hot ? 0.055 : 0.012) * (r.style === "family" ? 0.25 : 1)) {
      const bbl = r.bbls[Math.floor(rng(s) * r.bbls.length)];
      const rec = resolveRec(parcels, s, bbl);
      if (rec && !s.holdings[bbl] && !s.listings.some((l) => l.bbl === bbl)) {
        const v = assetValue(rec, s.econ, initialCondition(rec));
        s.listings.push({
          bbl,
          ask: Math.round(v * rrange(s, 1, 1.14) / 1e3) * 1e3,
          listedM: s.month,
          expiresM: s.month + Math.round(rrange(s, 6, 12))
        });
      }
    }
    if (!r.bbls.length && r.debt > Math.max(0, r.cash)) {
      r.failedM = s.month;
      s.news.unshift({
        q: s.month,
        kind: "warn",
        text: `${r.name} is done. They sold the last building months ago and the debt outlived the portfolio \u2014 there is nothing for the receiver to take.`
      });
      continue;
    }
    const stressed = ltv2 > st.maxLtv + 0.05 || r.cash < 0;
    if (stressed && r.bbls.length) {
      r.stressMs = (r.stressMs ?? 0) + 1;
      if (r.stressMs % 2 === 0) {
        const bbl = r.bbls[Math.floor(rng(s) * r.bbls.length)];
        const rec = resolveRec(parcels, s, bbl);
        if (rec) {
          const v = assetValue(rec, s.econ, initialCondition(rec));
          const px = Math.round(v * rrange(s, 0.68, 0.88));
          r.bbls = r.bbls.filter((b) => b !== bbl);
          r.cash += px - gainsTax(r, px);
          r.debt = Math.max(0, r.debt - Math.round(px * 0.92));
          if (!s.listings.some((l) => l.bbl === bbl) && !s.holdings[bbl]) {
            s.listings.push({ bbl, ask: px, listedM: s.month, expiresM: s.month + 8, distress: true });
            s.news.unshift({
              q: s.month,
              kind: "event",
              text: `${r.name} is selling. ${rec.address} hits the tape at $${(px / 1e6).toFixed(2)}M \u2014 ${Math.round((1 - px / Math.max(1, v)) * 100)}% under appraisal. They have more where that came from.`
            });
          }
        }
      }
      if (r.stressMs > 30 && (r.cash < 0 || ltv2 > st.maxLtv + 0.2)) {
        r.failedM = s.month;
        s.news.unshift({
          q: s.month,
          kind: "warn",
          text: `${r.name} is finished \u2014 ${r.bbls.length} building${r.bbls.length === 1 ? "" : "s"} go to the lenders. A firm that was buying everything two years ago could not roll a single loan this month. The receiver will be selling for years.`
        });
      }
    } else if (r.stressMs) {
      r.stressMs = 0;
    }
  }
}
function rivalBuys(s, rec, price) {
  const seller = ownerOf(s, rec.bbl);
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  const candidates = livingRivals(s).filter((r) => {
    if (r === seller) return false;
    const st = STYLE[r.style];
    if (st.classes && !st.classes.includes(rec.class)) return false;
    const ltvNow = Math.min(r.targetLtv, st.maxLtv) * (ci < 0.8 ? 0.82 : 1);
    const equity2 = price * (1 - ltvNow);
    if (r.cash < equity2 + Math.max(5e5, r.cash * 0.05)) return false;
    const aumAfter = (r.aum ?? 0) + price;
    const debtAfter = r.debt + (price - equity2);
    if (aumAfter > 0 && debtAfter / aumAfter > st.maxLtv) return false;
    return true;
  });
  if (!candidates.length) return null;
  let best = candidates[0], bestW = -Infinity;
  for (const r of candidates) {
    const st = STYLE[r.style];
    const w = st.appetite * (1 + st.procyclical * ((s.econ.creditIdx ?? 1) - 1)) * (0.6 + rng(s) * 0.8);
    if (w > bestW) {
      bestW = w;
      best = r;
    }
  }
  if (seller) {
    seller.bbls = seller.bbls.filter((b) => b !== rec.bbl);
    const relief = Math.min(seller.debt, Math.round(price * seller.targetLtv));
    seller.debt -= relief;
    seller.cash += price - relief - gainsTax(seller, price);
  }
  const bestLtv = Math.min(best.targetLtv, STYLE[best.style].maxLtv) * (ci < 0.8 ? 0.82 : 1);
  const equity = Math.round(price * (1 - bestLtv));
  const closing = Math.round(price * 0.02);
  best.cash -= equity + closing;
  best.debt += price - equity;
  best.basis = Math.round((best.basis ?? 0) + price + closing);
  best.aum = Math.round((best.aum ?? 0) + price);
  transferDeed(s, rec.bbl, best, 0);
  recordComp(
    s,
    rec,
    price,
    best.name,
    seller?.name ?? "a private owner",
    s.listings.find((l) => l.bbl === rec.bbl)?.distress,
    seller ? assetGrade(seller, rec) : void 0
  );
  return best;
}
function rivalAsk(s, parcels, r, bbl) {
  const rec = resolveRec(parcels, s, bbl);
  const v = rec ? assetValue(rec, s.econ, initialCondition(rec)) : 0;
  const { ltv: ltv2 } = markRival(s, parcels, r);
  const st = STYLE[r.style];
  if (r.stressMs && r.stressMs > 4) {
    return { ask: Math.round(v * rrange(s, 0.8, 0.95)), note: `${r.name} needs the money \u2014 they are inside appraisal and they know you know.` };
  }
  if (ltv2 < st.maxLtv * 0.6 && r.style === "family") {
    return { ask: Math.round(v * rrange(s, 1.18, 1.45)), note: `${r.name} has owned it for two generations and does not need to sell. That is the number.` };
  }
  return { ask: Math.round(v * rrange(s, st.patience - 0.04, st.patience + 0.12)), note: `${r.name} will trade at the right price.` };
}

// src/engine/actions.ts
var CLOSING_PCT = 0.02;
var SALE_FRICTION = 0.012;
var CAP_GAINS_RATE = 0.2;
var RECAPTURE_RATE = 0.25;
var SALE_BROKERAGE = 0.015;
var TRANSFER_TAX = 6e-3;
var EXCHANGE_WINDOW_M = 6;
function clone3(s) {
  return JSON.parse(JSON.stringify(s));
}
function buyQuote(s, parcels, bbl, price, product, lev = 1) {
  const rec = resolveRec(parcels, s, bbl);
  const closing = Math.round(price * CLOSING_PCT);
  if (product === "cash" || !rec) return { principal: 0, ratePct: 0, equity: price + closing, capPremium: 0, bind: "none", ltvCap: 0, uwDscr: 0 };
  const prod = productById(product);
  if (prod.minCondition === "good" && initialCondition(rec) !== "good") {
    return { principal: 0, ratePct: 0, equity: price + closing, capPremium: 0, bind: "condition", ltvCap: prod.ltv, uwDscr: prod.uwDscr };
  }
  const q = quote(s, prod, price, noiAfterTaxYr(rec, s.econ, initialCondition(rec), price));
  const principal = Math.round(q.principal * Math.max(0, Math.min(1, lev)));
  const capped = prod.ltv * price;
  const prod2 = productById(product);
  const capPremium = prod2.floating ? Math.round(principal * 0.0125) : 0;
  return {
    principal,
    ratePct: q.ratePct,
    equity: price - principal + closing + capPremium,
    capPremium,
    bind: q.dscrConstrained ? "dscr" : q.dyConstrained ? "dy" : q.principal < capped * 0.995 ? "credit" : "ltv",
    ltvCap: prod.ltv,
    uwDscr: prod.uwDscr
  };
}
function executePurchase(s, parcels, bbl, price, product, offMarket, lev = 1) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (s.holdings[bbl]) return { s, err: "You already own it." };
  const bq = buyQuote(s, parcels, bbl, price, product, lev);
  if (s.cash < bq.equity) {
    return { s, err: `This deal needs $${(bq.equity / 1e6).toFixed(2)}M ${product === "cash" ? "all-cash" : "of equity"} \u2014 you're short.` };
  }
  const next = clone3(s);
  next.cash -= bq.equity;
  logBooks(next, "bought", bq.equity);
  {
    const seller = ownerOf(next, bbl);
    if (seller) {
      seller.bbls = seller.bbls.filter((b) => b !== bbl);
      const relief = Math.min(seller.debt, Math.round(price * seller.targetLtv));
      seller.debt -= relief;
      seller.cash += price - relief;
    }
  }
  const holding = {
    bbl,
    boughtM: next.month,
    costBasis: price + Math.round(price * CLOSING_PCT),
    assessed: price,
    // the sale reassesses the property at the deal price
    loan: null,
    condition: initialCondition(rec),
    tenants: [],
    cfHistory: [],
    // A landmark stays a landmark when the deed moves.
    ...s.landmarks?.[bbl] !== void 0 ? { landmarked: true } : {}
  };
  if (product !== "cash") {
    const prod = productById(product);
    holding.loan = originate(next, prod, price, noiAfterTaxYr(rec, next.econ, holding.condition, price), lev, holding.condition);
  }
  if (next.exchange && price >= next.exchange.minPrice * 0.8) {
    holding.costBasis -= next.exchange.rolledGain;
    next.news.unshift({
      q: next.month,
      kind: "deal",
      text: `1031 completed: $${(next.exchange.rolledGain / 1e6).toFixed(2)}M of gain rolled into ${rec.address} \u2014 $${(next.exchange.deferredTax / 1e6).toFixed(2)}M of tax deferred.`
    });
    next.exchange = null;
  }
  genRentRoll(next, rec, holding);
  next.holdings[bbl] = holding;
  const halfBuilt = next.listings.find((l) => l.bbl === bbl)?.halfBuilt;
  next.listings = next.listings.filter((l) => l.bbl !== bbl);
  delete next.approaches[bbl];
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Deed recorded: ${rec.address} for $${(price / 1e6).toFixed(2)}M${holding.loan ? ` ($${(holding.loan.principal / 1e6).toFixed(1)}M ${holding.loan.product} at ${holding.loan.ratePct}%)` : ", all cash"}${offMarket ? " \u2014 off-market" : ""}.`
  });
  if (halfBuilt) takeoverDevelopment(next, parcels, bbl, halfBuilt);
  recordComp(
    next,
    rec,
    price,
    "You",
    ownerOf(s, bbl)?.name ?? (offMarket ? "a private owner" : "a listed seller"),
    s.listings.find((l) => l.bbl === bbl)?.distress,
    holding.condition
  );
  return { s: next };
}
function bidOdds(s, listing, bid) {
  const disc = 1 - bid / Math.max(1, listing.ask);
  const phase = s.econ.phase === "recession" ? 0.16 : s.econ.phase === "expansion" ? -0.12 : 0;
  const motivated = listing.distress ? 0.18 : 0;
  const room = (marketAppetite(s) - 1) * 0.22;
  return Math.max(0.02, Math.min(0.98, 1.02 - disc * 6.2 + phase + motivated - room));
}
function buyListing(s, parcels, bbl, product, lev = 1, bid) {
  const listing = s.listings.find((l) => l.bbl === bbl);
  if (!listing) return { s, err: "That property is no longer on the market." };
  const price = Math.round(bid ?? listing.ask);
  if (price >= listing.ask) {
    const st = clone3(s);
    return executePurchase(st, parcels, bbl, listing.ask, product, false, lev);
  }
  const q = buyQuote(s, parcels, bbl, price, product, lev);
  if (s.cash < q.equity) return { s, err: `That bid still needs $${(q.equity / 1e6).toFixed(2)}M of equity \u2014 you're short.` };
  const next = clone3(s);
  const p = bidOdds(next, listing, price);
  const roll = rng(next);
  if (roll < p) {
    const done = executePurchase(next, parcels, bbl, price, product, false, lev);
    if (done.err) return { s, err: done.err };
    return { s: done.s, msg: `They took $${(price / 1e6).toFixed(2)}M.` };
  }
  if (roll < p + 0.45) {
    next.news.unshift({ q: next.month, kind: "info", text: `Your $${(price / 1e6).toFixed(2)}M on ${parcels[bbl]?.address} was refused \u2014 the ask stands.` });
    return { s: next, msg: "Refused. The ask stands." };
  }
  next.listings = next.listings.filter((l) => l.bbl !== bbl);
  next.news.unshift({ q: next.month, kind: "warn", text: `The seller at ${parcels[bbl]?.address} took the listing elsewhere after your offer.` });
  return { s: next, msg: "They walked, and pulled the listing." };
}
function assemblagePressure(s, adjacency, bbl) {
  const nbrs = adjacency[bbl] ?? [];
  if (!nbrs.length) return 0;
  return nbrs.filter((n) => s.holdings[n]).length / nbrs.length;
}
function mergeCost(s, lots) {
  return Math.round((45e3 + 3e4 * lots) * s.econ.costIdx);
}
function assembleLots(s, parcels, adjacency, bbls) {
  const list = [...new Set(bbls)];
  if (list.length < 2) return { s, err: "Assemblage takes at least two lots." };
  for (const b of list) {
    if (!s.holdings[b]) return { s, err: "You have to own every lot in the assemblage." };
    if (s.merged?.[b]) return { s, err: "One of those is already part of an assemblage." };
    const rec2 = resolveRec(parcels, s, b);
    if (!rec2) return { s, err: "Unknown parcel." };
    if (rec2.class !== "land" || rec2.bldgArea > 0) {
      return { s, err: `${rec2.address} still has a building on it. Clear the site before folding the deeds together.` };
    }
    if (s.landmarks?.[b] !== void 0) return { s, err: "One of those is landmarked. Its envelope is frozen and it cannot be folded into a bigger site." };
    if (s.developments[b]) return { s, err: "Construction is already underway on one of those." };
    if (s.holdings[b].sale) return { s, err: "One of those is on the market \u2014 pull the listing first." };
    if (s.groundLeases?.[b]) return { s, err: "One of those is under a ground lease. It is not yours to build on." };
  }
  const set = new Set(list);
  const seen = /* @__PURE__ */ new Set([list[0]]);
  const queue = [list[0]];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of adjacency[cur] ?? []) {
      if (set.has(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  if (seen.size !== list.length) return { s, err: "Those lots do not touch. An assemblage has to be one contiguous site." };
  const cost = mergeCost(s, list.length);
  if (s.cash < cost) return { s, err: `The survey, the title work and the lawyers run $${(cost / 1e3).toFixed(0)}k \u2014 you're short.` };
  const sorted = [...list].sort((a, b) => (parcels[b]?.lotArea ?? 0) - (parcels[a]?.lotArea ?? 0));
  const parent = sorted[0];
  const next = clone3(s);
  next.cash -= cost;
  logBooks(next, "dev", cost);
  if (!next.merged) next.merged = {};
  let area = parcels[parent]?.lotArea ?? 0;
  for (const b of sorted.slice(1)) {
    next.merged[b] = parent;
    area += parcels[b]?.lotArea ?? 0;
    next.holdings[parent].costBasis += next.holdings[b].costBasis;
    next.holdings[b].costBasis = 0;
  }
  const rec = resolveRec(parcels, next, parent);
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Assembled: ${list.length} lots at ${rec.address} are now one site of ${Math.round(area).toLocaleString()} sf, ${(rec.lotArea * Math.max(rec.farMaxComm, rec.farMaxRes) / 1e3).toFixed(0)}k sf buildable. That is what all those premiums were for.`
  });
  return { s: next, msg: `${list.length} lots merged into one site.` };
}
function groundLeaseQuote(s, parcels, bbl, years) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class !== "land" || !rec.lotArea) return null;
  const land = assetValue(rec, s.econ, "standard");
  const capPct = Math.max(3.4, s.econ.indexRate * 0.62 + 2.5) * (years >= 75 ? 0.9 : years >= 50 ? 0.96 : 1.04);
  const rentYr = Math.round(land * (capPct / 100));
  return {
    land,
    rentYr,
    capPct: +capPct.toFixed(2),
    years,
    stepPct: +(years >= 75 ? 12 : 10).toFixed(0),
    stepEveryM: 120
  };
}
function grantGroundLease(s, parcels, bbl, years) {
  if (!s.holdings[bbl]) return { s, err: "You don't own that." };
  if (s.groundLeases?.[bbl]) return { s, err: "It is already ground-leased." };
  if (s.holdings[bbl].sale) return { s, err: "It's on the market \u2014 pull the listing before you encumber it." };
  if (s.developments[bbl]) return { s, err: "Construction is already underway." };
  if (s.merged?.[bbl]) return { s, err: "That lot is part of an assemblage \u2014 lease the whole site or none of it." };
  const q = groundLeaseQuote(s, parcels, bbl, years);
  if (!q || q.rentYr <= 0) return { s, err: "Nobody will ground-lease that." };
  const next = clone3(s);
  if (!next.groundLeases) next.groundLeases = {};
  next.holdings[bbl].groundLeased = true;
  next.groundLeases[bbl] = {
    bbl,
    startM: next.month,
    endM: next.month + years * 12,
    rentYr: q.rentYr,
    stepPct: q.stepPct,
    stepEveryM: q.stepEveryM,
    lastStepM: next.month,
    tenant: groundTenant(next)
  };
  const rec = resolveRec(parcels, next, bbl);
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Ground lease signed at ${rec.address}: $${(q.rentYr / 1e6).toFixed(2)}M a year for ${years} years, ${q.stepPct}% every ten. You keep the dirt and you do not touch it again until ${monthLabel(next.month + years * 12)}.`
  });
  return { s: next, msg: `Ground-leased for ${years} years.` };
}
var GROUND_TENANTS = [
  "a hotel operator",
  "a grocery chain",
  "a self-storage operator",
  "a hospital system",
  "a car dealership group",
  "a data-centre developer",
  "a church",
  "a university"
];
function groundTenant(s) {
  return GROUND_TENANTS[Math.floor(rng(s) * GROUND_TENANTS.length)];
}
function tickGroundLeases(s, parcels) {
  for (const [bbl, gl] of Object.entries(s.groundLeases ?? {})) {
    if (!s.holdings[bbl]) {
      delete s.groundLeases[bbl];
      continue;
    }
    if (s.month >= gl.endM) {
      const rec = resolveRec(parcels, s, bbl);
      delete s.groundLeases[bbl];
      delete s.holdings[bbl].groundLeased;
      s.news.unshift({
        q: s.month,
        kind: "event",
        text: `The ground lease at ${rec?.address ?? bbl} has run out. The land is yours again, and whatever they built on it is yours too.`
      });
      continue;
    }
    if (s.month - gl.lastStepM >= gl.stepEveryM) {
      gl.rentYr = Math.round(gl.rentYr * (1 + gl.stepPct / 100));
      gl.lastStepM = s.month;
      const rec = resolveRec(parcels, s, bbl);
      s.news.unshift({
        q: s.month,
        kind: "info",
        text: `Rent review at ${rec?.address ?? bbl}: the ground rent steps to $${(gl.rentYr / 1e6).toFixed(2)}M.`
      });
    }
    s.cash += gl.rentYr / 12;
    logBooks(s, "noi", gl.rentYr / 12);
  }
}
function approachOwner(s, parcels, adjacency, bbl) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (s.holdings[bbl]) return { s, err: "You own it." };
  if (s.listings.some((l) => l.bbl === bbl)) return { s, err: "It's already listed \u2014 hit the Market tab." };
  const prior = s.approaches[bbl];
  if (prior && s.month < prior.q + 6) {
    return { s, err: prior.refused ? "You knocked recently \u2014 the owner hasn't changed their mind." : "You already have their number \u2014 it's good for a while." };
  }
  const next = clone3(s);
  const pressure = assemblagePressure(next, adjacency, bbl);
  const refuseP = Math.min(0.9, Math.max(
    0.1,
    0.34 + 0.35 * pressure - (rec.class === "land" ? 0.12 : 0) - (next.econ.phase === "recession" ? 0.1 : 0) + (demandLinear(rec.demandScore) - 50) / 500
  ));
  if (rng(next) < refuseP) {
    next.approaches[bbl] = { q: next.month, refused: true };
    next.news.unshift({ q: next.month, kind: "info", text: `${rec.address}: the owner isn't selling${pressure > 0.4 ? " \u2014 they know what you're assembling" : ""}.` });
    return { s: next, refused: true };
  }
  const premium = 1.06 + 0.5 * Math.pow(rng(next), 2) + 0.22 * pressure;
  const ask = Math.round(assetValue(rec, next.econ, initialCondition(rec)) * premium / 1e3) * 1e3;
  next.approaches[bbl] = { q: next.month, refused: false, ask };
  next.news.unshift({ q: next.month, kind: "info", text: `${rec.address}: the owner would take $${(ask / 1e6).toFixed(2)}M. The number holds for six months.` });
  return { s: next, ask };
}
function buyOffMarket(s, parcels, bbl, product, lev = 1, bid) {
  const a = s.approaches[bbl];
  if (!a || a.refused || !a.ask) return { s, err: "No live ask \u2014 approach the owner first." };
  if (s.month > a.q + 6) return { s, err: "That number expired." };
  const price = Math.round(bid ?? a.ask);
  if (price >= a.ask) return executePurchase(s, parcels, bbl, a.ask, product, true, lev);
  const q = buyQuote(s, parcels, bbl, price, product, lev);
  if (s.cash < q.equity) return { s, err: `That bid still needs $${(q.equity / 1e6).toFixed(2)}M of equity \u2014 you're short.` };
  const next = clone3(s);
  const disc = 1 - price / Math.max(1, a.ask);
  const p = Math.max(0.02, Math.min(0.9, 0.92 - disc * 11 + (next.econ.phase === "recession" ? 0.12 : 0)));
  const roll = rng(next);
  if (roll < p) {
    const done = executePurchase(next, parcels, bbl, price, product, true, lev);
    if (done.err) return { s, err: done.err };
    return { s: done.s, msg: `Done at $${(price / 1e6).toFixed(2)}M, off-market.` };
  }
  if (roll < p + 0.4) {
    next.news.unshift({ q: next.month, kind: "info", text: `${parcels[bbl]?.address}: the owner didn't move off $${(a.ask / 1e6).toFixed(2)}M.` });
    return { s: next, msg: "They held their number." };
  }
  const na = next.approaches[bbl];
  na.refused = true;
  delete na.ask;
  next.news.unshift({ q: next.month, kind: "warn", text: `${parcels[bbl]?.address}: the owner ended the conversation.` });
  return { s: next, msg: "They ended the conversation." };
}
function counterOffMarket(s, parcels, adjacency, bbl, offerPx) {
  const a = s.approaches[bbl];
  const rec = resolveRec(parcels, s, bbl);
  if (!a || a.refused || !a.ask || !rec) return { s, err: "No live ask to counter." };
  if (a.countered) return { s, err: "You already countered \u2014 the number on the table is the number." };
  if (s.month > a.q + 6) return { s, err: "That number expired." };
  const next = clone3(s);
  const na = next.approaches[bbl];
  na.countered = true;
  const px = Math.round(offerPx ?? a.ask * 0.88);
  const cut = Math.max(0, 1 - px / a.ask);
  const pressure = assemblagePressure(next, adjacency, bbl);
  const pTake = Math.max(0.05, Math.min(
    0.8,
    0.48 - (cut - 0.12) * 2.6 - 0.35 * pressure + (next.econ.phase === "recession" ? 0.18 : 0) - (next.econ.phase === "expansion" ? 0.08 : 0)
  ));
  const roll = rng(next);
  if (roll < pTake) {
    na.ask = Math.round(px / 1e3) * 1e3;
    next.news.unshift({ q: next.month, kind: "deal", text: `${rec.address}: the owner grumbled and took your number \u2014 $${(na.ask / 1e6).toFixed(2)}M.` });
    return { s: next, msg: "They took it." };
  }
  if (roll < pTake + 0.45) {
    next.news.unshift({ q: next.month, kind: "info", text: `${rec.address}: the owner didn't move. $${(a.ask / 1e6).toFixed(2)}M stands.` });
    return { s: next, msg: "They held firm." };
  }
  na.refused = true;
  delete na.ask;
  next.news.unshift({ q: next.month, kind: "info", text: `${rec.address}: the owner hung up. The door is closed for a while.` });
  return { s: next, msg: "They walked." };
}
function listForSale(s, parcels, bbl, ask, mode = "quiet") {
  if (s.merged?.[bbl]) return { s, err: "That deed is part of an assemblage. Sell the site, not the piece." };
  if (s.groundLeases?.[bbl]) return { s, err: "It is ground-leased. You do not get that corner back until the term runs out." };
  const h = s.holdings[bbl];
  if (!h) return { s, err: "You don't own that parcel." };
  if (h.renovatingUntilM !== void 0 && s.month < h.renovatingUntilM) {
    return { s, err: "Can't market it mid-renovation \u2014 finish the work first." };
  }
  if (s.developments[bbl]) return { s, err: "Can't sell with cranes on site \u2014 deliver the building first." };
  if (s.portfolioSale?.bbls.includes(bbl)) {
    return { s, err: "That one is inside the portfolio you have in the market. Pull it out of the bundle first." };
  }
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (!Number.isFinite(ask) || ask <= 0) return { s, err: "Name a real number." };
  const next = clone3(s);
  if (mode === "marketed") {
    const weeks = Math.round(rrange(next, 2, 4));
    next.holdings[bbl].sale = {
      ask: Math.round(ask),
      listedM: next.month,
      mode: "marketed",
      callM: next.month + weeks,
      round: 0
    };
    next.news.unshift({
      q: next.month,
      kind: "info",
      text: `${rec.address} is on the market properly: a whisper of $${(ask / 1e6).toFixed(2)}M, offers due ${monthLabel(next.month + weeks)}. The broker takes 2.5% and earns it if the book is any good.`
    });
    return { s: next };
  }
  next.holdings[bbl].sale = { ask: Math.round(ask), listedM: next.month, mode: "quiet" };
  next.news.unshift({ q: next.month, kind: "info", text: `${rec.address} goes to market at $${(ask / 1e6).toFixed(2)}M. No broker, no campaign \u2014 you wait for the phone.` });
  return { s: next };
}
function saleFeeRate(h) {
  return h.sale?.mode === "marketed" ? 0.025 : SALE_BROKERAGE;
}
var BIDDER_NAMES = [
  "a pension fund adviser",
  "a family office",
  "a listed REIT",
  "an overseas buyer",
  "a local operator",
  "a debt fund taking equity risk",
  "a 1031 buyer on a clock",
  "an insurance company",
  "a private syndicate"
];
function runCallForOffers(s, parcels, h) {
  const rec = resolveRec(parcels, s, h.bbl);
  const sale = h.sale;
  if (!rec || !sale) return;
  const value = holdingValue(rec, s.econ, h, s.month);
  const ratio = sale.ask / Math.max(1, value);
  const appetite = marketAppetite(s);
  const phase = s.econ.phase === "peak" ? 1.5 : s.econ.phase === "expansion" ? 1.25 : s.econ.phase === "recovery" ? 0.8 : 0.35;
  const expected = Math.max(0, 3.4 * phase * Math.max(0.3, appetite) * Math.max(0.25, 2.1 - ratio));
  let n = Math.floor(expected) + (rng(s) < expected % 1 ? 1 : 0);
  n = Math.min(6, n);
  const bids = [];
  const used = /* @__PURE__ */ new Set();
  for (let i = 0; i < n; i++) {
    let name = BIDDER_NAMES[Math.floor(rng(s) * BIDDER_NAMES.length)];
    let guard = 0;
    while (used.has(name) && guard++ < 12) name = BIDDER_NAMES[Math.floor(rng(s) * BIDDER_NAMES.length)];
    used.add(name);
    const enthusiasm = rng(s);
    const price = Math.round(value * (0.9 + 0.26 * enthusiasm * Math.max(0.55, Math.min(1.35, phase))));
    const credibility = Math.max(0.2, Math.min(0.97, 1 - 0.55 * enthusiasm + (rng(s) - 0.5) * 0.3));
    bids.push({
      name,
      price,
      credibility,
      note: credibility > 0.75 ? "Cash to close, no financing condition." : credibility > 0.5 ? "Financed, but the lender is known." : "Aggressive number. Read the covenant before you count on it."
    });
  }
  bids.sort((a, b) => b.price - a.price);
  sale.bids = bids;
  delete sale.callM;
  if (!bids.length) {
    s.news.unshift({
      q: s.month,
      kind: "warn",
      text: `Offers were due at ${rec.address} and nobody bid. The book went out to the whole market and the whole market passed \u2014 that is information about your number, or about the building.`
    });
    return;
  }
  const top = bids[0].price;
  s.news.unshift({
    q: s.month,
    kind: "deal",
    text: `${bids.length} bid${bids.length === 1 ? "" : "s"} in at ${rec.address}. Best is $${(top / 1e6).toFixed(2)}M from ${bids[0].name}` + (bids.length > 1 ? `, against $${(bids[1].price / 1e6).toFixed(2)}M second` : "") + `. ${top >= sale.ask ? "Over the whisper." : `${Math.round((1 - top / Math.max(1, sale.ask)) * 100)}% under the whisper.`}`
  });
}
function bestAndFinal(s, parcels, bbl) {
  const h = s.holdings[bbl];
  const sale = h?.sale;
  if (!sale?.bids?.length) return { s, err: "There is no bid list to go back to." };
  if ((sale.round ?? 0) > 0) return { s, err: "You have already been back to them once. Twice and you are the story, not the building." };
  const next = clone3(s);
  const ns = next.holdings[bbl].sale;
  const live = (ns.bids ?? []).filter((b) => !b.dropped).slice(0, 3);
  const rec = resolveRec(parcels, next, bbl);
  let walked = 0, lifted = 0;
  for (const b of live) {
    const pWalk = 0.3 * (1 - b.credibility) + (next.econ.phase === "recession" ? 0.18 : 0);
    if (rng(next) < pWalk) {
      b.dropped = true;
      walked++;
      continue;
    }
    const bump = 1 + rrange(next, 5e-3, 0.055) * b.credibility;
    const before = b.price;
    b.price = Math.round(b.price * bump);
    if (b.price > before) lifted++;
  }
  ns.round = 1;
  ns.bids = (ns.bids ?? []).sort((a, b) => (a.dropped ? 1 : 0) - (b.dropped ? 1 : 0) || b.price - a.price);
  const best = ns.bids.find((b) => !b.dropped);
  next.news.unshift({
    q: next.month,
    kind: best ? "deal" : "warn",
    text: `Best and final at ${rec?.address ?? bbl}: ${lifted} sharpened, ${walked} walked. ` + (best ? `The number to beat is $${(best.price / 1e6).toFixed(2)}M from ${best.name}.` : `Everybody left the table. That was the risk and it came in.`)
  });
  return { s: next, msg: best ? "Bids refreshed." : "They all walked." };
}
function acceptBid(s, parcels, bbl, index) {
  const h = s.holdings[bbl];
  const sale = h?.sale;
  const bid = sale?.bids?.[index];
  if (!bid || bid.dropped) return { s, err: "That bid is not on the table." };
  const next = clone3(s);
  const ns = next.holdings[bbl].sale;
  const b = ns.bids[index];
  const rec = resolveRec(parcels, next, bbl);
  const pRetrade = 0.42 * (1 - b.credibility);
  if (rng(next) < pRetrade) {
    const cut = rrange(next, 0.02, 0.08);
    const price = Math.round(b.price * (1 - cut));
    const reasons = [
      "their engineer found the roof",
      "their lender resized the loan",
      "they read the rent roll properly and did not like the rollover",
      "their committee would not approve the number",
      "the environmental report came back with a question"
    ];
    const reason = reasons[Math.floor(rng(next) * reasons.length)];
    ns.offer = { price, expiresM: next.month + 2, from: b.name, retrade: reason };
    delete ns.bids;
    next.news.unshift({
      q: next.month,
      kind: "warn",
      text: `${b.name} has retraded ${rec?.address ?? bbl} \u2014 ${reason}. They are at $${(price / 1e6).toFixed(2)}M now, down from $${(b.price / 1e6).toFixed(2)}M. Take it, counter it, or tell them no.`
    });
    return { s: next, msg: "They retraded you." };
  }
  ns.offer = { price: b.price, expiresM: next.month + 2, from: b.name };
  delete ns.bids;
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `${b.name} is under contract at ${rec?.address ?? bbl} for $${(b.price / 1e6).toFixed(2)}M, clean. Close it.`
  });
  return { s: next, msg: "Under contract." };
}
function unsolicitedBidder(s, parcels, adjacency, rec, h) {
  const firms = livingRivals(s).filter((r) => !r.stressMs);
  const nbrs = new Set(adjacency?.[rec.bbl] ?? []);
  const neighbour = nbrs.size ? firms.find((r) => r.bbls.filter((b) => nbrs.has(b)).length >= 2) : void 0;
  if (neighbour && rec.class === "land") {
    return {
      name: neighbour.name,
      why: `They own ${neighbour.bbls.filter((b) => nbrs.has(b)).length} of the lots around it and they are assembling a site. This is the number somebody pays when your dirt is the last piece.`,
      mult: rrange(s, 1.22, 1.55)
    };
  }
  if (neighbour) {
    return {
      name: neighbour.name,
      why: `They have the deeds either side. A building on the corner of somebody else's assemblage is worth more to them than it is to the market, and they have just told you how much more.`,
      mult: rrange(s, 1.12, 1.34)
    };
  }
  const collector = firms.map((r) => ({
    r,
    n: r.bbls.filter((b) => (resolveRec(parcels, s, b)?.class ?? "") === rec.class).length
  })).filter((x) => x.n >= 3).sort((a, b) => b.n - a.n)[0];
  if (collector && rng(s) < 0.7) {
    return {
      name: collector.r.name,
      why: `They already own ${collector.n} like it and would rather buy yours quietly than bid against the city for the next one.`,
      mult: rrange(s, 1.04, 1.16)
    };
  }
  const occ = rec.bldgArea > 0 ? Math.min(1, h.tenants.reduce((a, t) => a + t.sf, 0) / rec.bldgArea + (h.occ ?? 0) * 0.5) : 1;
  const who = firms.length ? firms[Math.floor(rng(s) * firms.length)].name : "An out-of-town buyer";
  return occ < 0.7 ? { name: who, why: "They have read the rent roll and they are pricing the empty floors, not the building.", mult: rrange(s, 0.84, 0.96) } : { name: who, why: "No particular reason beyond wanting it. Those are the ones worth listening to.", mult: rrange(s, 0.98, 1.14) };
}
function delist(s, bbl) {
  const next = clone3(s);
  if (next.holdings[bbl]?.sale) delete next.holdings[bbl].sale;
  return next;
}
function saleTaxQuote(h, price) {
  const net = Math.round(price * (1 - saleFeeRate(h) - TRANSFER_TAX - SALE_FRICTION));
  const depr = h.deprTaken ?? 0;
  const adjBasis = h.costBasis - depr;
  const gain = net - adjBasis;
  const recapture = Math.max(0, Math.min(depr, gain));
  const appreciation = Math.max(0, gain - recapture);
  const tax = Math.round(recapture * RECAPTURE_RATE + appreciation * CAP_GAINS_RATE);
  return { net, gain, tax, recapture, appreciation };
}
function acceptSaleOffer(s, parcels, bbl, exchange = false) {
  const h = s.holdings[bbl];
  const offer = h?.sale?.offer;
  if (!h || !offer) return { s, err: "No live offer." };
  if (s.month > offer.expiresM) return { s, err: "That offer lapsed." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const { net, gain, tax } = saleTaxQuote(h, offer.price);
  if (exchange && s.exchange) return { s, err: "One exchange at a time \u2014 close the live 1031 first." };
  if (exchange && tax <= 0) return { s, err: "No gain to shelter \u2014 just take the cash." };
  const next = clone3(s);
  const kick = h.loan?.kicker && gain > 0 ? Math.round(gain * h.loan.kicker) : 0;
  const breakFee = h.loan ? prepayPenalty(h.loan, next.month) : 0;
  const toSeller = net - (h.loan?.balance ?? 0) - kick - breakFee;
  next.cash += toSeller;
  logBooks(next, "sold", toSeller);
  if (kick + breakFee > 0) logBooks(next, "debtSvc", kick + breakFee);
  if (exchange) {
    next.exchange = { deferredTax: tax, rolledGain: gain, minPrice: offer.price, deadlineM: next.month + EXCHANGE_WINDOW_M };
  } else if (tax > 0) {
    next.cash -= tax;
    next.taxesPaid = (next.taxesPaid ?? 0) + tax;
    logBooks(next, "taxes", tax);
  }
  next.exits = next.exits ?? [];
  next.exits.push({ bbl, address: rec.address, boughtM: h.boughtM, soldM: next.month, price: offer.price, basis: h.costBasis, gain });
  recordComp(next, rec, offer.price, "a buyer", "You", void 0, h.condition);
  if (next.exits.length > 200) next.exits.shift();
  for (const [child, parent] of Object.entries(next.merged ?? {})) {
    if (parent !== bbl) continue;
    delete next.merged[child];
    delete next.holdings[child];
    if (next.workouts?.[child]) delete next.workouts[child];
  }
  if (next.groundLeases?.[bbl]) delete next.groundLeases[bbl];
  next.cash -= depositsOn(next.holdings[bbl]);
  delete next.holdings[bbl];
  if (next.workouts?.[bbl]) delete next.workouts[bbl];
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Closed: ${rec.address} at $${(offer.price / 1e6).toFixed(2)}M \u2014 ${gain >= 0 ? "a gain" : "a loss"} of $${(Math.abs(gain) / 1e6).toFixed(2)}M against basis` + (kick > 0 ? `. Your lender took $${(kick / 1e6).toFixed(2)}M of the gain` : "") + (breakFee > 0 ? `, and $${(breakFee / 1e6).toFixed(2)}M to break the loan early` : "") + (exchange ? `. 1031 clock running: buy for \u2265 $${(offer.price * 0.8 / 1e6).toFixed(1)}M by ${monthLabel(next.month + EXCHANGE_WINDOW_M)} or $${(tax / 1e6).toFixed(2)}M of tax comes due.` : tax > 0 ? ` ($${(tax / 1e6).toFixed(2)}M capital-gains tax withheld).` : ".")
  });
  return { s: next };
}
function declineSaleOffer(s, bbl) {
  const next = clone3(s);
  const sale = next.holdings[bbl]?.sale;
  if (sale?.offer) delete sale.offer;
  return next;
}
function tickBrokerCalls(s, parcels, bbls) {
  if (s.month < 12) return;
  const owned = Object.keys(s.holdings).length;
  const hot = s.econ.phase === "expansion" || s.econ.phase === "peak";
  const p = Math.min(0.06, (0.011 + 4e-3 * Math.min(8, owned)) * (hot ? 1.25 : 0.7) * Math.max(0.5, s.econ.creditIdx ?? 1));
  if (rng(s) >= p) return;
  const ref = Object.values(s.holdings).map((h) => resolveRec(parcels, s, h.bbl)).filter(Boolean);
  const wantClass = ref.length && rng(s) < 0.65 ? ref[Math.floor(rng(s) * ref.length) % ref.length].class : null;
  let best = null;
  for (let i = 0; i < 90; i++) {
    const bbl = bbls[Math.floor(rng(s) * bbls.length)];
    if (s.holdings[bbl] || s.approaches[bbl] || s.listings.some((l) => l.bbl === bbl)) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    if (wantClass && rec.class !== wantClass && rng(s) < 0.7) continue;
    const v = assetValue(rec, s.econ, initialCondition(rec));
    const nw = netWorthLike(s);
    const floor = Math.min(2e7, Math.max(0, nw * 0.05));
    if (v <= 0 || v < floor || v > Math.max(6e6, nw * 1.6)) continue;
    best = rec;
    break;
  }
  if (!best) return;
  const owner = ownerOf(s, best.bbl);
  const value = assetValue(best, s.econ, initialCondition(best));
  let ask;
  let who;
  if (owner) {
    const q = rivalAsk(s, parcels, owner, best.bbl);
    ask = Math.round(q.ask / 1e3) * 1e3;
    who = q.note;
  } else {
    const motivated = s.econ.phase === "recession" ? rrange(s, 0.78, 0.9) : rrange(s, 0.84, 0.92);
    ask = Math.round(value * motivated / 1e3) * 1e3;
    who = "Their client needs it done this quarter \u2014 that is why you are hearing about it.";
  }
  if (ask > value * 0.92) return;
  s.approaches[best.bbl] = { q: s.month, refused: false, ask, inbound: true };
  s.news.unshift({
    q: s.month,
    kind: "deal",
    text: `A broker called about ${best.address} \u2014 ${best.bldgArea.toLocaleString()} sf, off market, whisper number $${(ask / 1e6).toFixed(2)}M against roughly $${(value / 1e6).toFixed(2)}M of value. ${who}`
  });
}
function netWorthLike(s) {
  let n = s.cash;
  for (const h of Object.values(s.holdings)) n += Math.max(0, h.costBasis - (h.loan?.balance ?? 0));
  return n;
}
function counterSale(s, parcels, bbl, price) {
  const h0 = s.holdings[bbl];
  if (!h0?.sale?.offer) return { s, err: "There is no offer to counter." };
  if (h0.sale.offer.countered) return { s, err: "You have already been back to them once on this offer." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const px = Math.round(price);
  const next = clone3(s);
  const h = next.holdings[bbl];
  const sale = h.sale;
  const offer = sale.offer;
  if (px <= offer.price) return { s, err: "That is not a counter \u2014 it is an acceptance at a worse price." };
  const value = holdingValue(rec, next.econ, h, next.month);
  const hot = next.econ.phase === "expansion" || next.econ.phase === "peak";
  const money4 = Math.max(0.4, next.econ.creditIdx ?? 1);
  const stretch = (hot ? 1.1 : 0.99) * (0.94 + 0.12 * money4);
  const reservation = Math.max(offer.price, Math.round(value * stretch * rrange(next, 0.97, 1.05)));
  if (px <= reservation) {
    const was = offer.price;
    offer.price = px;
    offer.countered = true;
    offer.expiresM = next.month + 2;
    next.news.unshift({
      q: next.month,
      kind: "deal",
      text: `They took your counter at ${rec.address}: $${(px / 1e6).toFixed(2)}M, up from $${(was / 1e6).toFixed(2)}M.`
    });
    return { s: next, msg: `Countered and taken \u2014 $${(px / 1e6).toFixed(2)}M.` };
  }
  if (px <= reservation * 1.06) {
    const split = Math.round((px + reservation) / 2);
    offer.price = split;
    offer.countered = true;
    offer.expiresM = next.month + 2;
    next.news.unshift({
      q: next.month,
      kind: "deal",
      text: `They came back at ${rec.address}: $${(split / 1e6).toFixed(2)}M and no further. Good until ${monthLabel(offer.expiresM)}.`
    });
    return { s: next, msg: `They split it \u2014 $${(split / 1e6).toFixed(2)}M.` };
  }
  const wasUnsolicited = sale.unsolicited;
  delete sale.offer;
  if (wasUnsolicited) delete h.sale;
  next.news.unshift({
    q: next.month,
    kind: "warn",
    text: `Your counter at ${rec.address} ended it \u2014 they walked.` + (wasUnsolicited ? " They were never on the market for it; they just wanted the building." : "")
  });
  return { s: next, msg: "They walked." };
}
function tickSales(s, parcels, adjacency = null) {
  for (const h of Object.values(s.holdings)) {
    if (!h.sale && !s.developments[h.bbl]) {
      const rec0 = resolveRec(parcels, s, h.bbl);
      const anyLive = Object.values(s.holdings).some((x) => x.sale?.unsolicited) || (s.portfolioSale?.bbls.includes(h.bbl) ?? false);
      const quiet = s.month - (s.lastUnsolicitedM ?? -60) > 30;
      if (rec0 && s.month - h.boughtM > 18 && !anyLive && quiet) {
        const hot = s.econ.phase === "expansion" || s.econ.phase === "peak";
        const money4 = Math.max(0.4, s.econ.creditIdx ?? 1);
        const p2 = (hot ? 2e-3 : 6e-4) * money4 * (1 + rec0.demandScore / 140);
        if (rng(s) < p2) {
          s.lastUnsolicitedM = s.month;
          const v = holdingValue(rec0, s.econ, h, s.month);
          const bidder = unsolicitedBidder(s, parcels, adjacency, rec0, h);
          const px = Math.round(v * bidder.mult * (hot ? rrange(s, 1, 1.1) : rrange(s, 0.86, 0.98)));
          h.sale = { ask: px, listedM: s.month, unsolicited: true };
          h.sale.offer = { price: px, expiresM: s.month + 2, from: bidder.name };
          s.news.unshift({
            q: s.month,
            kind: "deal",
            text: `${bidder.name} rang about ${rec0.address}: $${(px / 1e6).toFixed(2)}M, ${px >= v ? `${Math.round((px / Math.max(1, v) - 1) * 100)}% over` : `${Math.round((1 - px / Math.max(1, v)) * 100)}% under`} appraisal. ${bidder.why} It's good for two months.`
          });
        }
      }
    }
    const sale = h.sale;
    if (!sale) continue;
    if (sale.callM !== void 0 && s.month >= sale.callM) runCallForOffers(s, parcels, h);
    if (sale.bids && !sale.bids.length) {
      delete sale.bids;
      sale.mode = "quiet";
    }
    if (sale.bids?.length) {
      if (s.month - sale.listedM > 14) {
        const rec0 = resolveRec(parcels, s, h.bbl);
        delete sale.bids;
        delete h.sale;
        s.news.unshift({
          q: s.month,
          kind: "warn",
          text: `The bids on ${rec0?.address ?? h.bbl} have expired. You sat on the list too long and the buyers moved on.`
        });
      }
      continue;
    }
    if (sale.offer && s.month > sale.offer.expiresM) {
      delete sale.offer;
      if (sale.unsolicited) delete h.sale;
      continue;
    }
    if (sale.unsolicited && !sale.offer) {
      delete h.sale;
      continue;
    }
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    if (sale.offer) {
      const value2 = holdingValue(rec, s.econ, h, s.month);
      if (sale.offer.price < sale.ask && sale.ask / Math.max(1, value2) < 1.1 && rng(s) < 0.12) {
        const bumped = Math.min(sale.ask, Math.round(sale.offer.price * rrange(s, 1.02, 1.06)));
        if (bumped > sale.offer.price) {
          sale.offer = { price: bumped, expiresM: s.month + 2 };
          s.news.unshift({
            q: s.month,
            kind: "deal",
            text: `A second bidder surfaced at ${rec.address} \u2014 the offer moves to $${(bumped / 1e6).toFixed(2)}M.`
          });
        }
      }
      continue;
    }
    const value = holdingValue(rec, s.econ, h, s.month);
    const ratio = sale.ask / Math.max(1, value);
    const phaseAdj = s.econ.phase === "expansion" ? 1.3 : s.econ.phase === "recession" ? 0.5 : 1;
    const staleness = Math.min(0.06, (s.month - sale.listedM) * 4e-3);
    const p = Math.max(0.01, Math.min(0.5, (0.55 - 0.42 * ratio) * phaseAdj + staleness));
    if (rng(s) < p) {
      const bid = Math.min(sale.ask, value * (0.9 + rng(s) * 0.13));
      sale.offer = { price: Math.round(bid), expiresM: s.month + 2 };
      s.news.unshift({
        q: s.month,
        kind: "deal",
        text: `Offer in: $${(sale.offer.price / 1e6).toFixed(2)}M for ${rec.address} (ask $${(sale.ask / 1e6).toFixed(2)}M). Good for two months.`
      });
    }
  }
}
function tickListingAbsorption(s, parcels) {
  const base = s.econ.phase === "expansion" ? 0.1 : s.econ.phase === "peak" ? 0.07 : s.econ.phase === "recovery" ? 0.05 : 0.02;
  const survivors = [];
  for (const li of s.listings) {
    const rec = resolveRec(parcels, s, li.bbl);
    if (!rec) continue;
    if (s.talks?.agreed && s.talks.bbl === li.bbl) {
      survivors.push(li);
      continue;
    }
    const value = assetValue(rec, s.econ, initialCondition(rec));
    const ratio = li.ask / Math.max(1, value);
    const priceFactor = Math.max(0.3, Math.min(1.8, 1.9 - ratio));
    if (rng(s) < base * priceFactor * Math.max(0.25, marketAppetite(s))) {
      const buyer = rivalBuys(s, rec, li.ask);
      if (buyer) {
        s.news.unshift({
          q: s.month,
          kind: "info",
          text: `${buyer.name} took ${rec.address} at $${(li.ask / 1e6).toFixed(2)}M. You watched it happen.`
        });
      } else if (rng(s) < 0.5) {
        s.news.unshift({ q: s.month, kind: "info", text: `Sold: ${rec.address} went to a buyer from out of town at $${(li.ask / 1e6).toFixed(2)}M.` });
      }
      continue;
    }
    survivors.push(li);
  }
  s.listings = survivors;
}
function setBroker(s, parcels, bbl, on) {
  const h = s.holdings[bbl];
  const rec = resolveRec(parcels, s, bbl);
  if (!h || !rec) return { s, err: "You don't own that." };
  if (on && !isCommercial(rec)) return { s, err: "Brokers work commercial space \u2014 multifamily leases itself." };
  const next = clone3(s);
  const nh = next.holdings[bbl];
  if (on) nh.broker = true;
  else delete nh.broker;
  next.news.unshift({
    q: next.month,
    kind: "info",
    text: on ? `Leasing exclusive signed at ${rec.address} \u2014 the brokers start working the phones.` : `Broker dismissed at ${rec.address}.`
  });
  return { s: next };
}
function startRenovation(s, parcels, bbl) {
  const h = s.holdings[bbl];
  if (!h) return { s, err: "You don't own that parcel." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || rec.class === "land" || !rec.bldgArea) return { s, err: "Nothing to renovate on this lot." };
  if (h.condition === "good") return { s, err: "Already in top condition." };
  if (h.renovatingUntilM !== void 0) return { s, err: "Crews are already on site." };
  if (isCommercial(rec)) {
    const leased = h.tenants.reduce((sum, t) => sum + t.sf, 0);
    if (leased / rec.bldgArea > 0.35) {
      return { s, err: "Too much of the building is under lease to gut it \u2014 let the roll burn down below 35% first." };
    }
  }
  const cost = renovationCost(rec, s.econ);
  if (s.cash < cost) return { s, err: `Renovation costs $${(cost / 1e6).toFixed(2)}M cash \u2014 you're short.` };
  const next = clone3(s);
  next.cash -= cost;
  logBooks(next, "capex", cost);
  const nh = next.holdings[bbl];
  nh.renovatingUntilM = next.month + RENO_MONTHS;
  nh.tenants = [];
  if (rec.class === "multifamily") nh.occ = 0;
  next.lois = next.lois.filter((l) => l.bbl !== bbl);
  next.news.unshift({
    q: next.month,
    kind: "info",
    text: `Scaffolding up at ${rec.address} \u2014 $${(cost / 1e6).toFixed(2)}M gut renovation, ${RENO_MONTHS} quarters.`
  });
  return { s: next };
}
function counterBid(s, parcels, bbl, index, price) {
  const h0 = s.holdings[bbl];
  const b0 = h0?.sale?.bids?.[index];
  if (!h0?.sale || !b0) return { s, err: "There is no bid there." };
  if (b0.dropped) return { s, err: "They already walked." };
  if (b0.countered) return { s, err: "You have been back to them once. That is what the etiquette allows." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const px = Math.round(price);
  if (px <= b0.price) return { s, err: "That is not a counter \u2014 it is an acceptance at a worse price." };
  const next = clone3(s);
  const bid = next.holdings[bbl].sale.bids[index];
  bid.countered = true;
  const value = holdingValue(rec, next.econ, next.holdings[bbl], next.month);
  const hot = next.econ.phase === "expansion" || next.econ.phase === "peak";
  const headroom = (0.02 + b0.credibility * 0.09) * (hot ? 1.25 : 0.85);
  const limit = Math.round(Math.max(b0.price, Math.min(value * 1.18, b0.price * (1 + headroom))));
  if (px <= limit) {
    bid.price = px;
    bid.note = "Came up on a private call.";
    next.news.unshift({
      q: next.month,
      kind: "deal",
      text: `${b0.name} came up to $${(px / 1e6).toFixed(2)}M at ${rec.address}, from $${(b0.price / 1e6).toFixed(2)}M.`
    });
    return { s: next, msg: `They came up \u2014 $${(px / 1e6).toFixed(2)}M.` };
  }
  if (px <= limit * 1.05) {
    const split = Math.round((px + limit) / 2);
    bid.price = split;
    bid.note = "Split the difference and stopped.";
    next.news.unshift({
      q: next.month,
      kind: "info",
      text: `${b0.name} split it at ${rec.address}: $${(split / 1e6).toFixed(2)}M and no further.`
    });
    return { s: next, msg: `They split it \u2014 $${(split / 1e6).toFixed(2)}M.` };
  }
  bid.dropped = true;
  bid.note = "Walked when you went back to them.";
  next.news.unshift({
    q: next.month,
    kind: "warn",
    text: `${b0.name} walked at ${rec.address}. You went back to them for $${(px / 1e6).toFixed(2)}M and they were done.`
  });
  return { s: next, msg: `${b0.name} walked.` };
}
function repriceListing(s, parcels, bbl, ask) {
  const h0 = s.holdings[bbl];
  if (!h0?.sale) return { s, err: "That is not on the market." };
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const px = Math.round(ask);
  if (!Number.isFinite(px) || px <= 0) return { s, err: "Name a real number." };
  if (px === h0.sale.ask) return { s, err: "That is the number you are already asking." };
  const next = clone3(s);
  const sale = next.holdings[bbl].sale;
  const was = sale.ask;
  const cut = px < was;
  sale.ask = px;
  if (cut) sale.listedM = next.month;
  if (!cut && sale.bids?.length) {
    for (const b of sale.bids) {
      if (b.dropped) continue;
      if (b.price < px * 0.9 && rng(next) < 0.5) {
        b.dropped = true;
        b.note = "Left when the ask went up.";
      }
    }
  }
  if (!cut && sale.offer && sale.offer.price < px * 0.92 && rng(next) < 0.45) {
    delete sale.offer;
  }
  next.news.unshift({
    q: next.month,
    kind: cut ? "info" : "warn",
    text: cut ? `Cut the ask at ${rec.address} to $${(px / 1e6).toFixed(2)}M from $${(was / 1e6).toFixed(2)}M. The phone starts again \u2014 and everybody now knows you want out.` : `Raised the ask at ${rec.address} to $${(px / 1e6).toFixed(2)}M from $${(was / 1e6).toFixed(2)}M. Anyone who was close to the old number has other buildings to look at.`
  });
  return { s: next, msg: cut ? "Repriced down." : "Repriced up." };
}

// src/engine/acquire.ts
var clone4 = (s) => JSON.parse(JSON.stringify(s));
var SELLERS = {
  estate: {
    label: "an estate",
    certainty: 0.055,
    floor: 0.87,
    patience: 0.75,
    dawdle: 0.06,
    blurb: "Executors, three heirs and a deadline. They want it done more than they want the last dollar."
  },
  institution: {
    label: "an institutional owner",
    certainty: 0.012,
    floor: 0.98,
    patience: 0.25,
    dawdle: 0.02,
    blurb: "A fund rebalancing out of the sector. They have a committee, a number, and no reason to like you."
  },
  partnership: {
    label: "a partnership in dispute",
    certainty: 0.04,
    floor: 0.9,
    patience: 0.55,
    dawdle: 0.16,
    blurb: "Two partners who no longer speak. Everything takes twice as long and nobody can say yes quickly."
  },
  developer: {
    label: "a developer taking profits",
    certainty: 0.03,
    floor: 0.93,
    patience: 0.4,
    dawdle: 0.04,
    blurb: "They built it, they leased it, and they are recycling the equity into the next one."
  },
  local: {
    label: "a local family owner",
    certainty: 0.035,
    floor: 0.92,
    patience: 0.6,
    dawdle: 0.08,
    blurb: "They have owned it since before you were born and they are in no hurry, but they are reasonable."
  },
  lender: {
    label: "a lender's receiver",
    certainty: 0.07,
    floor: 0.8,
    patience: 0.85,
    dawdle: 0.05,
    blurb: "A special servicer clearing a book. They will take a haircut to be rid of it and they will not warrant a thing."
  }
};
var sellerProfile = (k) => SELLERS[k];
function sellerOf(s, parcels, bbl) {
  const rival = ownerOf(s, bbl);
  if (rival) {
    return {
      kind: rival.stressMs && rival.stressMs > 4 ? "lender" : rival.style === "family" ? "local" : rival.style === "developer" ? "developer" : "institution",
      name: rival.name
    };
  }
  const li = s.listings.find((l) => l.bbl === bbl);
  const rec = parcels[bbl];
  let h = 2166136261;
  for (const ch of bbl + String(li?.listedM ?? 0)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const r = (h >>> 0) % 1e3 / 1e3;
  if (li?.distress) return { kind: r < 0.45 ? "lender" : r < 0.8 ? "estate" : "partnership", name: SELLERS[r < 0.45 ? "lender" : r < 0.8 ? "estate" : "partnership"].label };
  const kind = r < 0.22 ? "estate" : r < 0.46 ? "local" : r < 0.68 ? "institution" : r < 0.86 ? "partnership" : "developer";
  void rec;
  return { kind, name: SELLERS[kind].label };
}
function tickTalks(s, parcels) {
  const t = s.talks;
  if (!t) return;
  if (t.agreed) {
    if (s.month >= (t.closeByM ?? t.openedM + CLOSE_WINDOW_M)) {
      delete s.talks;
      const li = s.listings.find((l) => l.bbl === t.bbl);
      if (li && li.expiresM <= s.month) li.expiresM = s.month + 4;
      s.news.unshift({
        q: s.month,
        kind: "warn",
        text: `The contract on ${parcels[t.bbl]?.address ?? t.bbl} expired unfunded. ${t.sellerName} kept the deposit's worth of goodwill and put it back on the market.`
      });
    }
    return;
  }
  const gone = !s.listings.some((l) => l.bbl === t.bbl);
  if (gone) {
    delete s.talks;
    s.news.unshift({
      q: s.month,
      kind: "warn",
      text: `${parcels[t.bbl]?.address ?? t.bbl} went to somebody else while you were still talking about it.`
    });
  } else if (s.month - t.openedM >= 3) {
    delete s.talks;
    s.news.unshift({
      q: s.month,
      kind: "info",
      text: `${t.sellerName} has stopped waiting on ${parcels[t.bbl]?.address ?? t.bbl}. The building is still for sale if you want to start again.`
    });
  }
}
var OPEN_ROUNDS = {
  estate: 4,
  institution: 2,
  partnership: 3,
  developer: 3,
  local: 4,
  lender: 4
};
function reservationOf(s, parcels, bbl, sellerKind) {
  const prof = SELLERS[sellerKind];
  const rec = resolveRec(parcels, s, bbl);
  const li = s.listings.find((l) => l.bbl === bbl);
  const ask = li?.ask ?? (rec ? assetValue(rec, s.econ, initialCondition(rec)) : 0);
  const phase = s.econ.phase === "recession" ? -0.055 : s.econ.phase === "expansion" ? 0.03 : 0;
  const distress = li?.distress ? -0.06 : 0;
  const soured = s.approaches[bbl]?.soured ?? 0;
  const floor = Math.max(0.6, prof.floor + phase + distress + soured);
  const reservation = Math.round(ask * floor / (1 + prof.certainty));
  return { reservation, ask };
}
function negotiate(s, parcels, bbl, price) {
  const existing = s.talks;
  if (existing && existing.bbl !== bbl) {
    return { s, err: `You are mid-negotiation at ${parcels[existing.bbl]?.address ?? existing.bbl}. Finish it or walk away first.` };
  }
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  if (!s.listings.some((l) => l.bbl === bbl)) return { s, err: "That property is no longer on the market." };
  const shut = s.approaches[bbl]?.insultedUntilM;
  if (shut !== void 0 && s.month < shut) {
    return {
      s,
      err: `They are not taking your calls on this one until ${monthLabel(shut)}. It is still for sale \u2014 just not to you.`
    };
  }
  const px = Math.round(price);
  if (!Number.isFinite(px) || px <= 0) return { s, err: "Name a real number." };
  const next = clone4(s);
  const seller = existing ? { kind: existing.sellerKind, name: existing.sellerName } : sellerOf(next, parcels, bbl);
  const { reservation, ask } = reservationOf(next, parcels, bbl, seller.kind);
  const round = (existing?.round ?? 0) + 1;
  const maxRounds = existing?.maxRounds ?? OPEN_ROUNDS[seller.kind];
  const prof = SELLERS[seller.kind];
  if (px >= reservation) {
    return { s: strikeDeal(next, bbl, px, seller, rec.address), msg: `Agreed at ${fmtM(px)}. Now fund it.` };
  }
  const gap = px / Math.max(1, reservation);
  const insultAt = Math.max(ask * 0.68, reservation * 0.8);
  if (px < insultAt) {
    delete next.talks;
    const rival = ownerOf(next, bbl);
    const shutM = next.month + Math.round(rrange(next, rival ? 18 : 10, rival ? 30 : 18));
    const prior = next.approaches[bbl];
    next.approaches[bbl] = {
      ...prior ?? {},
      q: next.month,
      refused: true,
      insultedUntilM: shutM,
      soured: Math.min(0.1, (prior?.soured ?? 0) + (rival ? 0.05 : 0.03))
    };
    next.news.unshift({
      q: next.month,
      kind: "warn",
      text: `${fmtM(px)} at ${rec.address} ended it \u2014 ${((1 - px / Math.max(1, ask)) * 100).toFixed(0)}% under the ask. ${seller.name} is not interested in a conversation that starts there. They will not take your call on this building until ${monthLabel(shutM)}, and when they do their number will be higher than it is today. It is still for sale \u2014 just not to you.`
    });
    const li2 = next.listings.find((l) => l.bbl === bbl);
    if (li2) li2.expiresM = Math.min(li2.expiresM, next.month + 2);
    return { s: next, msg: "They ended it. That was an insult, not an offer." };
  }
  if (gap < 0.8 || round > maxRounds) {
    const theirs2 = Math.round(round > maxRounds ? reservation * 1.005 : ask * 0.985);
    next.talks = {
      bbl,
      sellerKind: seller.kind,
      sellerName: seller.name,
      yourPrice: px,
      theirPrice: theirs2,
      round,
      maxRounds,
      openedM: existing?.openedM ?? next.month,
      final: true,
      note: round > maxRounds ? `${seller.name} is done moving. ${fmtM(theirs2)} is the number; take it or leave it.` : `${seller.name} did not counter \u2014 ${fmtM(px)} is not in the conversation. They are at ${fmtM(theirs2)}.`
    };
    return { s: next, msg: round > maxRounds ? "Their final number." : "They didn't move." };
  }
  const prev = existing?.theirPrice ?? ask;
  const give = 0.28 + prof.patience * 0.22 + round * 0.06;
  const theirs = Math.max(reservation, Math.round(prev - (prev - Math.max(px, reservation)) * Math.min(0.85, give)));
  const roundsLeft = maxRounds - round;
  next.talks = {
    bbl,
    sellerKind: seller.kind,
    sellerName: seller.name,
    yourPrice: px,
    theirPrice: theirs,
    round,
    maxRounds,
    openedM: existing?.openedM ?? next.month,
    final: roundsLeft <= 0,
    note: roundsLeft <= 0 ? `${seller.name} counters at ${fmtM(theirs)} and says it is the last of it.` : `${seller.name} counters at ${fmtM(theirs)}. You are ${fmtM(theirs - px)} apart.`
  };
  next.news.unshift({
    q: next.month,
    kind: "info",
    text: `${rec.address}: you offered ${fmtM(px)}, ${seller.name} came back at ${fmtM(theirs)}.`
  });
  return { s: next, msg: `They countered at ${fmtM(theirs)}.` };
}
function acceptCounter(s, parcels) {
  const t = s.talks;
  if (!t) return { s, err: "There is nothing on the table." };
  if (t.agreed) return { s, err: "The price is already agreed. What is left is funding it." };
  const rec = resolveRec(parcels, s, t.bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const next = clone4(s);
  return {
    s: strikeDeal(next, t.bbl, t.theirPrice, { kind: t.sellerKind, name: t.sellerName }, rec.address),
    msg: `Agreed at ${fmtM(t.theirPrice)}. Now fund it.`
  };
}
var CLOSE_WINDOW_M = 3;
function strikeDeal(next, bbl, px, seller, address) {
  next.talks = {
    bbl,
    sellerKind: seller.kind,
    sellerName: seller.name,
    yourPrice: px,
    theirPrice: px,
    round: next.talks?.round ?? 1,
    maxRounds: next.talks?.maxRounds ?? OPEN_ROUNDS[seller.kind],
    openedM: next.talks?.openedM ?? next.month,
    agreed: true,
    agreedPrice: px,
    closeByM: next.month + CLOSE_WINDOW_M,
    note: `Agreed at ${fmtM(px)} with ${seller.name}. You are under contract \u2014 place the debt and fund it by ${monthLabel(next.month + CLOSE_WINDOW_M)} or the deal is off and somebody else gets it.`
  };
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Under contract at ${address}: ${fmtM(px)} agreed with ${seller.name}. Nothing has moved yet \u2014 the money is due by ${monthLabel(next.month + CLOSE_WINDOW_M)}.`
  });
  return next;
}
function closeDeal(s, parcels, product, lev) {
  const t = s.talks;
  if (!t?.agreed || t.agreedPrice === void 0) return { s, err: "Nothing is under contract." };
  const rec = resolveRec(parcels, s, t.bbl);
  if (!rec) return { s, err: "Unknown parcel." };
  const next = clone4(s);
  return closeAgreed(
    next,
    parcels,
    t.bbl,
    t.agreedPrice,
    product,
    lev,
    { kind: t.sellerKind, name: t.sellerName },
    rec.address
  );
}
function walkAway(s, parcels) {
  const t = s.talks;
  if (!t) return { s };
  const next = clone4(s);
  delete next.talks;
  const li = next.listings.find((l) => l.bbl === t.bbl);
  if (li && li.expiresM <= next.month) li.expiresM = next.month + 4;
  next.news.unshift({
    q: next.month,
    kind: "info",
    text: t.agreed ? `You tore up the contract on ${parcels[t.bbl]?.address ?? t.bbl}. ${t.sellerName} will remember that you could not fund it.` : `You walked away from ${parcels[t.bbl]?.address ?? t.bbl}. ${t.sellerName} will remember, but the building will still be there.`
  });
  return { s: next, msg: t.agreed ? "Contract torn up." : "Walked away." };
}
var fmtM = (n) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};
function closeAgreed(next, parcels, bbl, px, product, lev, seller, address) {
  const done = executePurchase(next, parcels, bbl, px, product, false, lev);
  if (done.err) return { s: next, err: done.err };
  const out = done.s;
  out.listings = out.listings.filter((l) => l.bbl !== bbl);
  delete out.talks;
  out.news.unshift({
    q: out.month,
    kind: "deal",
    text: `Bought ${address} from ${seller.name} at ${fmtM(px)}.`
  });
  return { s: out, msg: `Bought at ${fmtM(px)}.` };
}

// src/engine/portfolio.ts
var clone5 = (s) => JSON.parse(JSON.stringify(s));
function occOf(rec, h) {
  if (!rec.bldgArea) return 0;
  const comm = h.tenants.reduce((a, t) => a + t.sf, 0);
  const res = useSf(rec, "multifamily") * (h.occ ?? 0);
  return Math.min(1, (comm + res) / rec.bldgArea);
}
var money3 = (n) => Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1e3)}K`;
var RUN_M = 9;
var BUYERS = [
  { name: "Hollis Sterling Partners", min: 12e6, patience: 0.98 },
  { name: "Marchpane Institutional", min: 3e7, patience: 1.02 },
  { name: "The Ashgrove Trust", min: 8e6, patience: 0.95 },
  { name: "Kestrel Core Fund", min: 45e6, patience: 1.04 },
  { name: "Bellwether Opportunity", min: 6e6, patience: 0.88 }
];
function portfolioQuote(s, parcels, bbls) {
  const rows = bbls.map((b) => ({ bbl: b, h: s.holdings[b], rec: resolveRec(parcels, s, b) })).filter((r) => r.h && r.rec);
  const vals = rows.map((r) => holdingValue(r.rec, s.econ, r.h, s.month));
  const sumOfParts = Math.round(vals.reduce((a, v) => a + v, 0));
  const why = [];
  if (!rows.length || sumOfParts <= 0) {
    return { sumOfParts: 0, indicative: 0, spreadPct: 0, why, depth: 0, count: 0 };
  }
  const scale = Math.min(0.035, 6e-3 * Math.log2(Math.max(2, rows.length)) + Math.min(0.018, sumOfParts / 4e9));
  if (rows.length > 1) why.push({ label: `Scale \u2014 one diligence, one closing, ${rows.length} deeds`, pct: scale });
  const byClass = /* @__PURE__ */ new Map();
  const byDistrict = /* @__PURE__ */ new Map();
  rows.forEach((r, i) => {
    const k = r.rec.class;
    byClass.set(k, (byClass.get(k) ?? 0) + vals[i]);
    const d = r.rec.district ?? "?";
    byDistrict.set(d, (byDistrict.get(d) ?? 0) + vals[i]);
  });
  const topClass = Math.max(...byClass.values()) / sumOfParts;
  const topDist = Math.max(...byDistrict.values()) / sumOfParts;
  const mixed = -(1 - topClass) * 0.075 - (1 - topDist) * 0.03;
  if (mixed < -2e-3) {
    why.push({
      label: topClass < 0.6 ? `Mixed asset classes \u2014 ${byClass.size} of them, no majority` : `Not quite one story \u2014 ${(topClass * 100).toFixed(0)}% ${[...byClass.entries()].sort((a, b) => b[1] - a[1])[0][0]}, ${byDistrict.size} districts`,
      pct: mixed
    });
  }
  let weak = 0;
  rows.forEach((r, i) => {
    const built = r.rec.class !== "land" && r.rec.bldgArea > 0;
    const occ = built ? occOf(r.rec, r.h) : 1;
    const share = vals[i] / sumOfParts;
    let d = 0;
    if (built && occ < 0.82) d += (0.82 - occ) * 0.42;
    if (r.h.condition === "standard") d += 0.03;
    if (r.h.condition === "worn") d += 0.09;
    if (!built) d += 0.06;
    weak += share * d;
  });
  if (weak > 2e-3) {
    why.push({ label: "Underwritten off the weakest buildings, not the average", pct: -weak });
  }
  const depth = BUYERS.filter((b) => sumOfParts >= b.min).length - (sumOfParts > 2e8 ? 2 : sumOfParts > 9e7 ? 1 : 0);
  const thin = depth <= 1 ? -0.06 : depth === 2 ? -0.025 : 0;
  if (thin < 0) why.push({ label: `Thin bidder pool \u2014 ${Math.max(1, depth)} buyer${depth === 1 ? "" : "s"} in this city can fund it`, pct: thin });
  const ci = s.econ.creditIdx ?? 1;
  const credit = -Math.max(0, 1 - ci) * 0.18 - (s.econ.phase === "recession" ? 0.035 : 0);
  if (credit < -4e-3) {
    why.push({ label: ci < 0.8 ? "Credit is tight \u2014 nobody is funding a portfolio right now" : "Financing markets are soft", pct: credit });
  }
  const st = sponsorStanding(s);
  if (st.advanceCut > 0) {
    why.push({ label: "Your record \u2014 buyers price a forced seller", pct: -Math.min(0.05, st.advanceCut * 0.6) });
  }
  const bookShare = sumOfParts / Math.max(1, Object.keys(s.holdings).reduce((a, b) => {
    const rec = resolveRec(parcels, s, b);
    const h = s.holdings[b];
    return a + (rec && h ? holdingValue(rec, s.econ, h, s.month) : 0);
  }, 0));
  if (bookShare > 0.75 && rows.length >= 3) {
    why.push({ label: "This is essentially your whole book \u2014 everybody knows why you are selling", pct: -0.02 });
  }
  const total = Math.max(-0.4, why.reduce((a, x) => a + x.pct, 0));
  const indicative = Math.round(sumOfParts * (1 + total));
  return { sumOfParts, indicative, spreadPct: total, why, depth: Math.max(1, depth), count: rows.length };
}
function listPortfolio(s, parcels, bbls, ask) {
  if (s.portfolioSale) return { s, err: "You already have a portfolio in the market. One process at a time." };
  const clean = [...new Set(bbls)].filter((b) => s.holdings[b]);
  if (clean.length < 2) return { s, err: "A portfolio is two buildings or more. One building is a listing." };
  if (clean.some((b) => s.workouts?.[b])) {
    return { s, err: "One of these is in default. A lender in a workout controls that deed \u2014 clear the file first." };
  }
  const q = portfolioQuote(s, parcels, clean);
  if (ask <= 0) return { s, err: "Name a price." };
  const next = clone5(s);
  for (const b of clean) if (next.holdings[b]?.sale) delete next.holdings[b].sale;
  next.portfolioSale = { bbls: clean, ask: Math.round(ask), listedM: next.month, sumOfParts: q.sumOfParts, bids: [] };
  next.news.unshift({
    q: next.month,
    kind: "info",
    text: `Took ${clean.length} buildings to market as a portfolio at ${money3(ask)} \u2014 ${money3(q.sumOfParts)} of individual marks, so you are asking ${ask >= q.sumOfParts ? "a premium" : `${((1 - ask / q.sumOfParts) * 100).toFixed(0)}% under the sum of the parts`}. Indications inside ${RUN_M} months or the process goes stale.`
  });
  return { s: next, msg: "In the market." };
}
function delistPortfolio(s) {
  const next = clone5(s);
  delete next.portfolioSale;
  return next;
}
function repricePortfolio(s, ask) {
  if (!s.portfolioSale) return { s, err: "Nothing in the market." };
  if (ask <= 0) return { s, err: "Name a price." };
  const next = clone5(s);
  const old = next.portfolioSale.ask;
  next.portfolioSale.ask = Math.round(ask);
  if (ask > old * 1.02) {
    next.portfolioSale.bids = [];
    next.news.unshift({
      q: next.month,
      kind: "warn",
      text: `Raised the portfolio ask to ${money3(ask)} mid-process. Every indication in hand just went away \u2014 moving the goalposts on an institutional buyer is how you get taken off their list.`
    });
  } else {
    next.portfolioSale.listedM = next.month - 1;
    next.news.unshift({ q: next.month, kind: "info", text: `Portfolio repriced to ${money3(ask)}.` });
  }
  return { s: next, msg: "Repriced." };
}
function counterPortfolio(s, price) {
  const ps = s.portfolioSale;
  const best = ps?.bids?.[0];
  if (!ps || !best) return { s, err: "Nothing to answer." };
  const next = clone5(s);
  const nb = next.portfolioSale.bids[0];
  const stretch = price / Math.max(1, best.price);
  nb.countered = true;
  const give = Math.max(0, 1 - (stretch - 1) / 0.11);
  if (stretch <= 1.005) return { s, err: "That is their number. Take it or leave it." };
  if (rng(next) < give * 0.7) {
    const meet = Math.round(best.price + (price - best.price) * rrange(next, 0.4, 0.9));
    nb.price = meet;
    next.news.unshift({
      q: next.month,
      kind: "deal",
      text: `${best.name} came up to ${money3(meet)} on the portfolio. That is their committee number and there is nothing behind it.`
    });
    return { s: next, msg: "They moved." };
  }
  next.portfolioSale.bids = next.portfolioSale.bids.filter((b) => b.name !== best.name);
  next.news.unshift({
    q: next.month,
    kind: "warn",
    text: `${best.name} withdrew from the portfolio rather than chase ${money3(price)}. A bundle is a discretionary purchase \u2014 there is always another one next quarter.`
  });
  return { s: next, msg: "They walked." };
}
function acceptPortfolioBid(s, parcels, exchange = false) {
  const ps = s.portfolioSale;
  const bid = ps?.bids?.[0];
  if (!ps || !bid) return { s, err: "No live indication." };
  if (s.month > bid.expiresM) return { s, err: "That indication lapsed." };
  if (exchange && s.exchange) return { s, err: "One exchange at a time \u2014 close the live 1031 first." };
  const next = clone5(s);
  const live = ps.bbls.filter((b) => next.holdings[b]);
  const marks = live.map((b) => {
    const rec = resolveRec(parcels, next, b);
    return holdingValue(rec, next.econ, next.holdings[b], next.month);
  });
  const totalMark = marks.reduce((a, v) => a + v, 0);
  if (totalMark <= 0) return { s, err: "There is nothing left in that portfolio." };
  let proceeds = 0, taxTotal = 0, gainTotal = 0;
  live.forEach((bbl, i) => {
    const h = next.holdings[bbl];
    const rec = resolveRec(parcels, next, bbl);
    const price = Math.round(bid.price * (marks[i] / totalMark));
    const { net, gain, tax } = saleTaxQuote(h, price);
    const kick = h.loan?.kicker && gain > 0 ? Math.round(gain * h.loan.kicker) : 0;
    const breakFee = h.loan ? prepayPenalty(h.loan, next.month) : 0;
    proceeds += net - (h.loan?.balance ?? 0) - kick - breakFee;
    if (kick + breakFee > 0) logBooks(next, "debtSvc", kick + breakFee);
    gainTotal += gain;
    taxTotal += tax;
    next.exits.push({
      bbl,
      address: rec.address,
      boughtM: h.boughtM,
      soldM: next.month,
      price,
      basis: h.costBasis,
      gain
    });
    recordComp(next, rec, price, bid.name, "You", void 0, h.condition);
    if (next.groundLeases?.[bbl]) delete next.groundLeases[bbl];
    next.cash -= depositsOn(h);
    for (const [child, parent] of Object.entries(next.merged ?? {})) {
      if (parent !== bbl) continue;
      delete next.merged[child];
      delete next.holdings[child];
    }
    delete next.holdings[bbl];
    if (next.workouts?.[bbl]) delete next.workouts[bbl];
    next.lois = next.lois.filter((l) => l.bbl !== bbl);
  });
  while (next.exits.length > 200) next.exits.shift();
  next.cash += proceeds;
  logBooks(next, "sold", proceeds);
  if (exchange && taxTotal > 0) {
    next.exchange = {
      deferredTax: taxTotal,
      rolledGain: gainTotal,
      minPrice: bid.price,
      deadlineM: next.month + EXCHANGE_WINDOW_M
    };
  } else if (taxTotal > 0) {
    next.cash -= taxTotal;
    next.taxesPaid = (next.taxesPaid ?? 0) + taxTotal;
    logBooks(next, "taxes", taxTotal);
  }
  delete next.portfolioSale;
  next.news.unshift({
    q: next.month,
    kind: "deal",
    text: `Closed the portfolio: ${live.length} buildings to ${bid.name} at ${money3(bid.price)}, ${money3(proceeds)} to you after payoffs. ` + (exchange ? `1031 clock running \u2014 redeploy ${money3(bid.price * 0.8)} by ${monthLabel(next.month + EXCHANGE_WINDOW_M)} or ${money3(taxTotal)} of tax comes due.` : taxTotal > 0 ? `${money3(taxTotal)} of tax withheld.` : "No gain, no tax.")
  });
  return { s: next, msg: "Portfolio closed." };
}
function tickPortfolio(s, parcels) {
  const ps = s.portfolioSale;
  if (ps) {
    ps.bbls = ps.bbls.filter((b) => s.holdings[b]);
    if (ps.bbls.length < 2) {
      delete s.portfolioSale;
      s.news.unshift({ q: s.month, kind: "warn", text: "The portfolio process collapsed \u2014 there are not two buildings left in it." });
    }
  }
  const live = s.portfolioSale;
  if (live) {
    live.bids = (live.bids ?? []).filter((b) => s.month <= b.expiresM);
    const age = s.month - live.listedM;
    if (age > RUN_M && !live.bids.length) {
      delete s.portfolioSale;
      s.news.unshift({
        q: s.month,
        kind: "warn",
        text: `Nine months and no indication on the portfolio at ${money3(live.ask)}. The process is stale \u2014 every buyer in town has now seen it and passed, which is worth knowing and expensive to have learned.`
      });
    } else {
      const q = portfolioQuote(s, parcels, live.bbls);
      const eager = Math.min(1, q.indicative / Math.max(1, live.ask));
      const arrive = 0.3 * Math.pow(eager, 3.2) * Math.max(0.25, 1 - age / (RUN_M + 3));
      if (rng(s) < arrive && live.bids.length < 3) {
        const pool = BUYERS.filter((b) => q.sumOfParts >= b.min && !live.bids.some((x) => x.name === b.name));
        if (pool.length) {
          const who = pool[Math.floor(rng(s) * pool.length)];
          const price = Math.round(Math.min(live.ask, q.indicative * who.patience * rrange(s, 0.88, 1.02)));
          live.bids.push({ name: who.name, price, expiresM: s.month + 3 });
          live.bids.sort((a, b) => b.price - a.price);
          s.news.unshift({
            q: s.month,
            kind: "deal",
            text: `${who.name} indicated ${money3(price)} on the portfolio \u2014 ${((1 - price / Math.max(1, q.sumOfParts)) * 100).toFixed(0)}% inside the sum of the individual marks. That spread is what you are paying to clear ${live.bbls.length} buildings in one closing.`
          });
        }
      }
    }
  }
  if (!s.portfolioSale && Object.keys(s.holdings).length >= 5 && rng(s) < 0.012) {
    const byClass = /* @__PURE__ */ new Map();
    for (const bbl of Object.keys(s.holdings)) {
      if (s.workouts?.[bbl] || s.holdings[bbl].sale) continue;
      const rec = resolveRec(parcels, s, bbl);
      if (!rec || rec.class === "land") continue;
      const h = s.holdings[bbl];
      if (occOf(rec, h) < 0.8) continue;
      const arr = byClass.get(rec.class) ?? [];
      arr.push(bbl);
      byClass.set(rec.class, arr);
    }
    const best = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (best && best[1].length >= 3) {
      const bbls = best[1].slice(0, 6);
      const q = portfolioQuote(s, parcels, bbls);
      const who = BUYERS.filter((b) => q.sumOfParts >= b.min);
      if (who.length) {
        const buyer = who[Math.floor(rng(s) * who.length)];
        const price = Math.round(q.indicative * rrange(s, 1, 1.09));
        s.portfolioSale = {
          bbls,
          ask: price,
          listedM: s.month,
          sumOfParts: q.sumOfParts,
          unsolicited: true,
          bids: [{ name: buyer.name, price, expiresM: s.month + 4 }]
        };
        s.news.unshift({
          q: s.month,
          kind: "deal",
          text: `${buyer.name} rang unprompted with ${money3(price)} for ${bbls.length} of your ${best[0]} buildings \u2014 ${price >= q.sumOfParts ? "above" : `${((1 - price / q.sumOfParts) * 100).toFixed(0)}% inside`} the sum of the individual marks. Nobody offers on a portfolio they have not already underwritten, so this number is real. It is also for the buildings you would least like to sell, which is how you know they did the work.`
        });
      }
    }
  }
}

// src/engine/sim.ts
var LISTING_LIFE_M = [6, 12];
function targetListings(s, totalLots) {
  const base = s.econ.phase === "peak" ? 0.013 : s.econ.phase === "expansion" ? 0.01 : s.econ.phase === "recovery" ? 6e-3 : 4e-3;
  const ci = Math.max(0.4, Math.min(1.15, s.econ.creditIdx ?? 1));
  return Math.max(4, Math.round(totalLots * base * (0.55 + 0.5 * ci)));
}
function newGame(seed, parcels) {
  const s = {
    v: 20,
    seed,
    rng: seed,
    month: 0,
    cash: START_CASH,
    econ: null,
    holdings: {},
    listings: [],
    lois: [],
    nextLoiId: 1,
    approaches: {},
    developments: {},
    built: {},
    cityBuilt: [],
    landAdj: {},
    blockD: {},
    sponsor: { events: [] },
    rivals: [],
    lenderRel: {},
    lenders: initLenders(),
    workouts: {},
    totalLots: parcels ? Object.keys(parcels).length : 0,
    builtAtStart: parcels ? Object.values(parcels).filter((p) => p.class !== "land").length : 0,
    exchange: null,
    taxesPaid: 0,
    agent: false,
    loc: { balance: 0, drawnTotal: 0, interestPaid: 0 },
    books: [],
    nwHistory: [START_CASH],
    exits: [],
    milestones: {},
    news: [],
    gameOver: null,
    insolventMs: 0
  };
  s.econ = initEcon(s, parcels);
  if (parcels) s.rivals = initRivals(s, parcels, Object.keys(parcels));
  s.news.push({
    q: 0,
    kind: "info",
    text: `${monthLabel(0)}. You arrive with $6M and a hundred years. Half this town is still empty lots \u2014 the city will fill in around you, with or without your name on it.`
  });
  return s;
}
function refreshListings(s, parcels, bbls) {
  const ASK_FLOOR = 0.7;
  for (const li of s.listings) {
    const rec = resolveRec(parcels, s, li.bbl);
    const floor = rec ? assetValue(rec, s.econ, initialCondition(rec)) * ASK_FLOOR : 0;
    if (s.month - li.listedM >= 4) li.ask = Math.round(li.ask * 0.985 / 1e3) * 1e3;
    if (floor > 0 && li.ask < floor) li.ask = Math.round(floor / 1e3) * 1e3;
  }
  s.listings = s.listings.filter((l) => (l.expiresM > s.month || s.talks?.agreed && s.talks.bbl === l.bbl) && !s.holdings[l.bbl]);
  const listed = new Set(s.listings.map((l) => l.bbl));
  const target = targetListings(s, bbls.length);
  const pDistress = s.econ.phase === "recession" ? 0.42 : s.econ.phase === "recovery" ? 0.18 : 0.03;
  let guard = 0;
  while (s.listings.length < target && guard++ < 4e3) {
    const bbl = bbls[Math.floor(rng(s) * bbls.length)];
    if (listed.has(bbl) || s.holdings[bbl]) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const value = assetValue(rec, s.econ, initialCondition(rec));
    if (value <= 0) continue;
    if (value > 6e7 && rng(s) > 0.12) continue;
    const distress = rng(s) < pDistress;
    const denial = s.econ.phase === "recession" ? rrange(s, 1.1, 1.28) : s.econ.phase === "recovery" ? rrange(s, 1.02, 1.14) : rrange(s, 0.94, 1.1);
    const ask = Math.round(value * (distress ? rrange(s, 0.72, 0.9) : denial) / 1e3) * 1e3;
    s.listings.push({
      bbl,
      ask,
      listedM: s.month,
      expiresM: s.month + Math.round(rrange(s, ...LISTING_LIFE_M)),
      distress: distress || void 0
    });
    listed.add(bbl);
    if (distress && rng(s) < 0.6) {
      s.news.unshift({ q: s.month, kind: "event", text: `Motivated seller: ${rec.address} hits the tape at $${(ask / 1e6).toFixed(2)}M \u2014 well under appraisal. It won't last.` });
    }
  }
}
function advanceQuarter(prev, parcels, bbls, adjacency = null) {
  if (prev.gameOver) return prev;
  const s = JSON.parse(JSON.stringify(prev));
  s.month++;
  tickEcon(s);
  tickDemand(s, parcels);
  tickLenders(s);
  tickWorkouts(s, parcels);
  tickPortfolio(s, parcels);
  tickRivals(s, parcels);
  tickPlanning(s, parcels, bbls);
  tickCityGrowth(s, parcels, bbls, adjacency);
  tickDevelopments(s, parcels);
  tickConstructionLeasing(s, parcels);
  tickPrograms(s, parcels);
  tickLeasing(s, parcels);
  tickGroundLeases(s, parcels);
  tickSales(s, parcels, adjacency);
  tickBrokerCalls(s, parcels, bbls);
  tickListingAbsorption(s, parcels);
  tickTalks(s, parcels);
  if (s.exchange && s.month > s.exchange.deadlineM) {
    s.cash -= s.exchange.deferredTax;
    s.taxesPaid = (s.taxesPaid ?? 0) + s.exchange.deferredTax;
    logBooks(s, "taxes", s.exchange.deferredTax);
    s.news.unshift({
      q: s.month,
      kind: "warn",
      text: `The 1031 clock ran out \u2014 $${(s.exchange.deferredTax / 1e6).toFixed(2)}M of deferred capital-gains tax comes due.`
    });
    s.exchange = null;
  }
  let monthCF = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    if (h.renovatingUntilM !== void 0 && s.month >= h.renovatingUntilM) {
      h.condition = "good";
      h.lastCapM = s.month;
      delete h.renovatingUntilM;
      s.news.unshift({ q: s.month, kind: "deal", text: `Renovation complete at ${rec.address} \u2014 space re-opens at the new rent.` });
    }
    const noiQ = monthlyNOI(rec, s.econ, h, s.month);
    const debtCash = tickLoan(s, rec, h, noiQ);
    logBooks(s, "noi", noiQ);
    logBooks(s, "debtSvc", debtCash);
    if (!s.holdings[h.bbl]) continue;
    const cf = noiQ - debtCash;
    h.cfHistory.push(Math.round(cf));
    if (h.cfHistory.length > 40) h.cfHistory.shift();
    monthCF += cf;
  }
  s.cash += monthCF;
  {
    const n = Object.keys(s.holdings).length + Object.keys(s.developments ?? {}).length;
    if (n > 0) {
      let gav = 0;
      for (const h of Object.values(s.holdings)) {
        const rec = resolveRec(parcels, s, h.bbl);
        if (rec) gav += holdingValue(rec, s.econ, h, s.month);
      }
      for (const d of Object.values(s.developments ?? {})) gav += d.costTotal;
      const annual = 6e4 * s.econ.costIdx + 28e-4 * gav;
      const ga = Math.round(annual / 12);
      s.cash -= ga;
      logBooks(s, "ga", ga);
    }
  }
  if (s.cash > 0) {
    const interest = Math.round(s.cash * CASH_APY / 12);
    if (interest > 0) {
      s.cash += interest;
      logBooks(s, "interest", interest);
    }
  }
  for (const [bbl, a] of Object.entries(s.approaches)) {
    if (s.month > a.q + 12) {
      delete s.approaches[bbl];
      continue;
    }
    if (a.refused || !a.ask) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const v = assetValue(rec, s.econ, initialCondition(rec));
    if (v > 0 && a.ask < v * 0.85) {
      delete s.approaches[bbl];
      s.news.unshift({
        q: s.month,
        kind: "warn",
        text: `${rec.address}: the owner has withdrawn their number. The ground has moved since they gave it to you.`
      });
    }
  }
  if (s.month % 12 === 0 && s.month > 0) {
    let taxable = 0;
    for (const h of Object.values(s.holdings)) {
      const rec = resolveRec(parcels, s, h.bbl);
      if (!rec) continue;
      const v = holdingValue(rec, s.econ, h, s.month);
      const prior = h.assessed ?? h.costBasis;
      h.assessed = Math.round(prior + 0.25 * (v - prior));
      const noi = rec.class === "land" ? 0 : holdingNOIYr(rec, s.econ, h, s.month);
      const interest = h.loan ? h.loan.balance * h.loan.ratePct / 100 : 0;
      const improvements = h.costBasis * 0.8;
      const life = rec.class === "multifamily" ? 27.5 : 39;
      const deprCapacity = improvements - (h.deprTaken ?? 0);
      const depr = rec.class === "land" ? 0 : Math.max(0, Math.min(improvements / life, deprCapacity));
      h.deprTaken = (h.deprTaken ?? 0) + depr;
      taxable += noi - interest - depr;
    }
    const tax = Math.round(Math.max(0, taxable) * 0.25);
    if (tax > 1e3) {
      s.cash -= tax;
      s.taxesPaid = (s.taxesPaid ?? 0) + tax;
      logBooks(s, "taxes", tax);
      s.news.unshift({ q: s.month, kind: "info", text: `Tax season: $${(tax / 1e6).toFixed(2)}M due on last year's portfolio income (after interest and depreciation).` });
    }
  }
  if (s.cash < 0) {
    s.insolventMs++;
    if (s.insolventMs === 6) {
      s.news.unshift({ q: s.month, kind: "warn", text: "Your lenders have noticed the negative balance. Six more months of this and they start seizing assets." });
    }
    if (s.insolventMs >= 12) {
      const owned = Object.values(s.holdings).filter((h) => !s.developments[h.bbl] && !s.workouts?.[h.bbl]);
      if (owned.length) {
        let pick = owned[0], pickV = -Infinity;
        for (const h of owned) {
          const rec2 = resolveRec(parcels, s, h.bbl);
          const v = rec2 ? holdingValue(rec2, s.econ, h, s.month) : 0;
          if (v > pickV) {
            pickV = v;
            pick = h;
          }
        }
        const rec = resolveRec(parcels, s, pick.bbl);
        const gross = Math.round(pickV * Math.min(0.85, distressPrice(s)));
        const proceeds = Math.max(0, gross - (pick.loan?.balance ?? 0));
        s.cash += proceeds;
        logBooks(s, "sold", proceeds);
        recordComp(s, rec, gross, "a distressed buyer", "You", true, pick.condition);
        s.exits.push({ bbl: pick.bbl, address: rec.address, boughtM: pick.boughtM, soldM: s.month, price: gross, basis: pick.costBasis, gain: gross - pick.costBasis, forced: true });
        if (s.groundLeases?.[pick.bbl]) delete s.groundLeases[pick.bbl];
        s.cash -= depositsOn(s.holdings[pick.bbl]);
        delete s.holdings[pick.bbl];
        if (s.workouts?.[pick.bbl]) delete s.workouts[pick.bbl];
        markSponsor(s, "seized", rec.address, Math.max(0, (pick.loan?.balance ?? 0) - gross));
        s.lois = s.lois.filter((l) => l.bbl !== pick.bbl);
        s.news.unshift({
          q: s.month,
          kind: "warn",
          text: `The creditors took ${rec.address} \u2014 sold at $${(gross / 1e6).toFixed(2)}M, ${(100 * (1 - gross / Math.max(1, pickV))).toFixed(0)}% under the mark. ${s.cash < 0 ? "They're not done." : "The balance is square, barely."}`
        });
        s.insolventMs = 8;
      } else {
        s.gameOver = {
          cause: "Insolvency: the creditors took everything, and it wasn't enough. A hundred-year town remembers a bankruptcy."
        };
        s.news.unshift({ q: s.month, kind: "warn", text: "The run is over \u2014 the creditors own it now." });
      }
    }
  } else {
    s.insolventMs = 0;
  }
  tickLoc(s, parcels);
  const nw = netWorth(s, parcels);
  s.nwHistory.push(Math.round(nw));
  checkMilestones(s, nw);
  if (!s.milestones.century && s.month >= CENTURY_MONTHS) {
    s.milestones.century = s.month;
    const built = Math.round(100 * (s.builtAtStart + Object.keys(s.built).length) / Math.max(1, s.totalLots));
    s.news.unshift({
      q: s.month,
      kind: "event",
      text: `\u25C6 A hundred years. The place you arrived in was two-fifths empty lots; ${built}% of it stands built today, and ${Object.keys(s.holdings).length} of those buildings are yours. The clock keeps running.`
    });
  }
  refreshListings(s, parcels, bbls);
  if (s.news.length > 120) s.news.length = 120;
  for (const bbl of Object.keys(s.groundLeases ?? {})) {
    if (!s.holdings[bbl]) delete s.groundLeases[bbl];
  }
  for (const [child, parent] of Object.entries(s.merged ?? {})) {
    if (s.holdings[child] && s.holdings[parent]) continue;
    delete s.merged[child];
    delete s.holdings[child];
  }
  for (const bbl of Object.keys(s.workouts ?? {})) {
    if (!s.holdings[bbl]?.loan) delete s.workouts[bbl];
  }
  return s;
}
var MILESTONES = [
  { id: "deed1", label: "First deed recorded", test: (s) => Object.keys(s.holdings).length + s.exits.length >= 1 },
  { id: "lease1", label: "First lease signed", test: (s) => Object.values(s.holdings).some((h) => h.tenants.some((t) => t.startM > h.boughtM)) },
  { id: "tower1", label: "First development delivered", test: (s) => Object.keys(s.built).some((b) => !s.cityBuilt.includes(b)) },
  { id: "exit1", label: "First profitable exit", test: (s) => s.exits.some((e) => !e.forced && e.gain > 0) },
  { id: "nw25", label: "Net worth $25M", test: (_s, nw) => nw >= 25e6 },
  { id: "nw100", label: "Net worth $100M", test: (_s, nw) => nw >= 1e8 },
  { id: "nw500", label: "Net worth $500M", test: (_s, nw) => nw >= 5e8 },
  { id: "nw1b", label: "The billion-dollar book", test: (_s, nw) => nw >= 1e9 },
  { id: "ten", label: "Ten buildings under management", test: (s) => Object.keys(s.holdings).length >= 10 },
  { id: "twentyfive", label: "A quarter-hundred holdings", test: (s) => Object.keys(s.holdings).length >= 25 },
  { id: "half", label: "Fifty years in town", test: (s) => s.month >= 600 }
];
function checkMilestones(s, nw) {
  for (const m of MILESTONES) {
    if (s.milestones[m.id] === void 0 && m.test(s, nw)) {
      s.milestones[m.id] = s.month;
      s.news.unshift({ q: s.month, kind: "event", text: `\u25C6 Milestone: ${m.label}.` });
    }
  }
}
function attentionItems(s) {
  const out = [];
  for (const l of s.lois) out.push({ key: `loi:${l.id}`, label: `LOI from ${l.name} \u2014 answer by ${monthLabel(l.expiresM)}` });
  for (const [bbl, a] of Object.entries(s.approaches)) {
    if (a.inbound && !a.refused && a.ask) out.push({ key: `broker:${bbl}`, label: "A broker has something off-market for you" });
  }
  for (const h of Object.values(s.holdings)) {
    if (h.sale?.offer) out.push({ key: `offer:${h.bbl}:${h.sale.offer.price}`, label: `Offer in hand \u2014 good until ${monthLabel(h.sale.offer.expiresM)}` });
    if (h.loan && h.loan.maturityM - s.month <= 3 && h.loan.maturityM > s.month) {
      out.push({ key: `balloon:${h.bbl}`, label: `Balloon due ${monthLabel(h.loan.maturityM)}` });
    }
    if (h.loan?.sweep) out.push({ key: `sweep:${h.bbl}`, label: "Covenant breach \u2014 cash flow swept" });
  }
  if (s.talks) {
    out.push(s.talks.agreed ? {
      key: `contract:${s.talks.bbl}`,
      label: `Under contract at $${((s.talks.agreedPrice ?? s.talks.theirPrice) / 1e6).toFixed(2)}M \u2014 fund it by ${monthLabel(s.talks.closeByM ?? s.month)}`
    } : {
      key: `talks:${s.talks.bbl}:${s.talks.theirPrice}`,
      label: `${s.talks.sellerName} is at $${(s.talks.theirPrice / 1e6).toFixed(2)}M${s.talks.final ? " \u2014 their final word" : ""}`
    });
  }
  if (s.exchange && s.exchange.deadlineM - s.month <= 2) {
    out.push({ key: "exchange", label: `1031 clock: ${monthLabel(s.exchange.deadlineM)} deadline` });
  }
  if (s.cash < 0) out.push({ key: "cash", label: "Cash is negative" });
  for (const [id] of Object.entries(s.milestones)) {
    if (s.milestones[id] === s.month) out.push({ key: `mile:${id}`, label: "Milestone reached" });
  }
  if (s.gameOver) out.push({ key: "over", label: "The run is over" });
  return out;
}
function advanceUntilAttention(s, parcels, bbls, adjacency, cap) {
  const before = new Set(attentionItems(s).map((a) => a.key));
  let cur = s;
  for (let i = 1; i <= cap; i++) {
    cur = advanceQuarter(cur, parcels, bbls, adjacency);
    const now = attentionItems(cur);
    const fresh = now.find((a) => !before.has(a.key));
    if (fresh) return { s: cur, months: i, reason: fresh.label };
    if (cur.gameOver) return { s: cur, months: i, reason: null };
  }
  return { s: cur, months: cap, reason: null };
}
function portfolioQuarterlyCF(s, parcels) {
  let cf = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec) continue;
    cf += monthlyNOI(rec, s.econ, h, s.month) - (h.loan?.monthlyPmt ?? 0);
  }
  for (const d of Object.values(s.developments ?? {})) {
    cf -= d.loanBalance * d.ratePct / 100 / 12;
  }
  return cf;
}
function firstListings(s, parcels, bbls) {
  const next = JSON.parse(JSON.stringify(s));
  refreshListings(next, parcels, bbls);
  return next;
}

// src/engine/invariants.ts
var fin = (v) => typeof v === "number" && Number.isFinite(v);
function checkInvariants(s, parcels) {
  const v = [];
  const bad = (code, where, detail) => v.push({ code, where, detail });
  if (!fin(s.cash)) bad("nan", "firm", `cash is ${s.cash}`);
  if (!fin(s.month) || s.month < 0) bad("month", "firm", `month is ${s.month}`);
  if (!fin(s.taxesPaid) || s.taxesPaid < 0) bad("tax", "firm", `lifetime tax ${s.taxesPaid}`);
  if (s.loc) {
    if (!fin(s.loc.balance) || s.loc.balance < 0) bad("loc", "firm", `line balance ${s.loc.balance}`);
    if (s.loc.balance > s.loc.drawnTotal + 1) bad("loc", "firm", `line balance ${Math.round(s.loc.balance)} exceeds everything ever drawn ${Math.round(s.loc.drawnTotal)}`);
  }
  const nw = netWorth(s, parcels);
  if (!fin(nw)) bad("nan", "firm", "net worth is not a number");
  for (const [d, x] of Object.entries(s.zoneAdj ?? {})) {
    if (!fin(x) || x < 0.4 || x > 3) bad("zoning", `district ${d}`, `envelope multiplier ${x}`);
  }
  for (const [bbl, x] of Object.entries(s.variance ?? {})) {
    if (!fin(x) || x < 0 || x > FAR_CEILING * 0.4) bad("zoning", `variance ${bbl}`, `granted ${x} FAR`);
  }
  if (s.varianceApp) {
    const a = s.varianceApp;
    if (a.decideM < a.filedM) bad("zoning", "variance", "a hearing that decided before it was filed");
    if (!fin(a.odds) || a.odds < 0 || a.odds > 1) bad("zoning", "variance", `odds ${a.odds}`);
  }
  for (const bbl of Object.keys(s.landmarks ?? {})) {
    if (s.developments[bbl]) bad("zoning", `landmark ${bbl}`, "landmarked and under construction at once");
  }
  for (const k of SECTORS) {
    const mom = s.econ.industryMom?.[k];
    if (mom !== void 0 && (!fin(mom) || Math.abs(mom) > 0.06)) {
      bad("industry", "econ", `${k} momentum ${mom}`);
    }
    const ph = s.econ.industryPhase?.[k];
    if (ph !== void 0 && ph !== "boom" && ph !== "steady" && ph !== "bust") {
      bad("industry", "econ", `${k} is in phase "${ph}"`);
    }
  }
  for (const [bbl, b] of Object.entries(s.built ?? {})) {
    const cap = MAX_FLOORS_BY_USE[b.class];
    if (cap !== void 0 && b.floors > cap) {
      bad("massing", `built ${bbl}`, `${b.floors}-storey ${b.class} \u2014 the cap is ${cap}`);
    }
  }
  for (const j of s.cityJobs ?? []) {
    const cap = MAX_FLOORS_BY_USE[j.use];
    if (cap !== void 0 && j.floors > cap) {
      bad("massing", `job ${j.bbl}`, `${j.floors}-storey ${j.use} under construction \u2014 the cap is ${cap}`);
    }
  }
  for (const d of Object.values(s.developments ?? {})) {
    const cap = MAX_FLOORS_BY_USE[d.use];
    if (cap !== void 0 && d.floors > cap) {
      bad("massing", `development ${d.bbl}`, `${d.floors}-storey ${d.use} \u2014 the cap is ${cap}`);
    }
  }
  for (const [child, parent] of Object.entries(s.merged ?? {})) {
    const at = `assemblage ${child}`;
    if (child === parent) bad("merge", at, "a lot merged into itself");
    if (!s.holdings[child]) bad("merge", at, "a merged deed you do not own");
    if (!s.holdings[parent]) bad("merge", at, `merged into ${parent}, which you do not own`);
    if (s.merged[parent]) bad("merge", at, `merged into ${parent}, which is itself merged into something else`);
  }
  for (const [bbl, gl] of Object.entries(s.groundLeases ?? {})) {
    const at = `ground lease ${bbl}`;
    if (!s.holdings[bbl]) bad("ground", at, "a ground lease on land you do not own");
    if (!fin(gl.rentYr) || gl.rentYr < 0) bad("ground", at, `ground rent ${gl.rentYr}`);
    if (gl.endM <= gl.startM) bad("ground", at, "a lease that ends before it starts");
  }
  const e = s.econ;
  for (const [k, x] of Object.entries({ indexRate: e.indexRate, landIdx: e.landIdx, costIdx: e.costIdx, cycleDev: e.cycleDev, creditIdx: e.creditIdx })) {
    if (!fin(x)) bad("nan", "econ", `${k} is ${x}`);
  }
  if (fin(e.indexRate) && (e.indexRate < 0 || e.indexRate > 40)) bad("rate", "econ", `index rate ${e.indexRate}%`);
  if (fin(e.cycleDev) && Math.abs(e.cycleDev) > 1.0001) bad("cycle", "econ", `cycleDev ${e.cycleDev} outside [-1,1]`);
  for (const [cls, r] of Object.entries(e.rentIdx ?? {})) {
    if (!fin(r) || r <= 0) bad("rent", "econ", `${cls} rent index ${r}`);
  }
  for (const [cls, c] of Object.entries(e.capRate ?? {})) {
    if (!fin(c) || c <= 0.5 || c > 40) bad("cap", "econ", `${cls} cap rate ${c}%`);
  }
  for (const [bbl, h] of Object.entries(s.holdings)) {
    const at = `holding ${bbl}`;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) {
      bad("orphan", at, "owned parcel is not in the parcel table");
      continue;
    }
    if (h.bbl !== bbl) bad("key", at, `holding keyed ${bbl} but says it is ${h.bbl}`);
    if (!fin(h.costBasis) || h.costBasis < 0) bad("basis", at, `cost basis ${h.costBasis}`);
    if (h.boughtM > s.month) bad("time", at, `bought in month ${h.boughtM}, it is month ${s.month}`);
    if (h.deprTaken !== void 0 && (!fin(h.deprTaken) || h.deprTaken < -1)) bad("depr", at, `accumulated depreciation ${h.deprTaken}`);
    const val = holdingValue(rec, s.econ, h, s.month);
    if (!fin(val) || val < 0) bad("value", at, `holding value ${val}`);
    const noi = holdingNOIYr(rec, s.econ, h, s.month);
    if (!fin(noi)) bad("nan", at, "NOI is not a number");
    const leased = h.tenants.reduce((a, t) => a + t.sf, 0);
    if (!fin(leased) || leased < 0) bad("roll", at, `leased area ${leased}`);
    if (rec.bldgArea > 0 && leased > rec.bldgArea + 1) {
      bad("overleased", at, `${Math.round(leased).toLocaleString()} sf leased in a ${rec.bldgArea.toLocaleString()} sf building`);
    }
    if (rec.class === "land" && leased > 0) bad("roll", at, "a vacant site has tenants on it");
    const m = mixOf(rec);
    const shares = Object.values(m);
    if (rec.class !== "land") {
      const tot = shares.reduce((x, y) => x + y, 0);
      if (!fin(tot) || Math.abs(tot - 1) > 5e-3) bad("mix", at, `use shares sum to ${tot.toFixed(3)}, not 1`);
      for (const [u, sh] of Object.entries(m)) {
        if (!fin(sh) || sh <= 0 || sh > 1.0001) bad("mix", at, `${u} share is ${sh}`);
      }
      for (const u of Object.keys(m)) {
        const cap = useSf(rec, u);
        const inUse = h.tenants.filter((tn) => (tn.use ?? rec.class) === u).reduce((n, tn) => n + tn.sf, 0);
        if (inUse > cap + 1) {
          bad("overleased", at, `${Math.round(inUse).toLocaleString()} sf let in the ${u} part, which is ${Math.round(cap).toLocaleString()} sf`);
        }
      }
      for (const tn of h.tenants) {
        if (tn.use && !(tn.use in m)) bad("mix", at, `${tn.name} occupies ${tn.use} space in a building with none`);
        if (tn.use === "multifamily") bad("mix", at, `${tn.name} is a named tenant in the residential part`);
      }
    }
    for (const t of h.tenants) {
      if (!fin(t.sf) || t.sf <= 0) bad("tenant", at, `${t.name} occupies ${t.sf} sf`);
      if (!fin(t.rentPsf) || t.rentPsf < 0) bad("tenant", at, `${t.name} pays ${t.rentPsf}/sf`);
      if (t.endM < t.startM) bad("tenant", at, `${t.name}'s lease ends before it begins`);
    }
    const turning = (h.makeReady ?? []).reduce((a, m2) => a + m2.sf, 0);
    if (rec.bldgArea > 0 && leased + turning > rec.bldgArea * 1.02) {
      bad("overleased", at, `${Math.round(leased + turning).toLocaleString()} sf leased-or-turning in a ${rec.bldgArea.toLocaleString()} sf building`);
    }
    if (h.occ !== void 0 && (!fin(h.occ) || h.occ < 0 || h.occ > 1)) bad("occ", at, `occupancy ${h.occ}`);
    const l = h.loan;
    if (l) {
      if (!fin(l.balance) || l.balance < 0) bad("loan", at, `balance ${l.balance}`);
      if (!fin(l.principal) || l.principal <= 0) bad("loan", at, `original principal ${l.principal}`);
      if (l.balance > l.principal + 1) bad("loan", at, `balance ${Math.round(l.balance)} exceeds original principal ${Math.round(l.principal)}`);
      if (!fin(l.ratePct) || l.ratePct < 0 || l.ratePct > 60) bad("loan", at, `coupon ${l.ratePct}%`);
      if (!fin(l.monthlyPmt) || l.monthlyPmt < 0) bad("loan", at, `payment ${l.monthlyPmt}`);
      if (l.maturityM <= l.originM) bad("loan", at, "matures on or before it was written");
      if (l.originM > s.month) bad("loan", at, `originated in month ${l.originM}, it is month ${s.month}`);
      const interest = l.balance * l.ratePct / 100 / 12;
      if (l.balance > 1e3 && l.monthlyPmt + 1 < interest * 0.999) {
        bad("loan", at, `payment ${Math.round(l.monthlyPmt)} does not cover interest ${Math.round(interest)}`);
      }
    }
    if (h.sale && s.developments[bbl]) bad("state", at, "listed for sale while under construction");
  }
  for (const [bbl, d] of Object.entries(s.developments ?? {})) {
    const at = `development ${bbl}`;
    if (!fin(d.costTotal) || d.costTotal <= 0) bad("dev", at, `budget ${d.costTotal}`);
    if (!fin(d.drawn) || d.drawn < 0) bad("dev", at, `drawn ${d.drawn}`);
    if (d.drawn > d.commitment + 1) bad("dev", at, `drawn ${Math.round(d.drawn)} exceeds the commitment ${Math.round(d.commitment)}`);
    if (d.loanBalance < d.drawn - 1) bad("dev", at, `loan balance ${Math.round(d.loanBalance)} is below what has been drawn ${Math.round(d.drawn)}`);
    if (d.reserveUsed > d.interestReserve + 1) bad("dev", at, `interest reserve overdrawn by ${Math.round(d.reserveUsed - d.interestReserve)}`);
    if (d.contingencyUsed > d.contingency + 1) bad("dev", at, `contingency overdrawn by ${Math.round(d.contingencyUsed - d.contingency)}`);
    if (d.equitySpent > d.equityBudget * 3) bad("dev", at, `equity spent ${Math.round(d.equitySpent)} against a budget of ${Math.round(d.equityBudget)}`);
    if (d.deliverM <= d.startM) bad("dev", at, "delivers on or before it starts");
    if (!fin(d.sf) || d.sf <= 0) bad("dev", at, `programme is ${d.sf} sf`);
    if (s.holdings[bbl] && s.holdings[bbl].sale) bad("state", at, "under construction and on the market at once");
  }
  const seen = /* @__PURE__ */ new Set();
  for (const li of s.listings) {
    if (!parcels[li.bbl]) bad("listing", `listing ${li.bbl}`, "not a real parcel");
    if (!fin(li.ask) || li.ask <= 0) bad("listing", `listing ${li.bbl}`, `ask ${li.ask}`);
    if (s.holdings[li.bbl]) bad("listing", `listing ${li.bbl}`, "the market is selling you a building you already own");
    if (seen.has(li.bbl)) bad("listing", `listing ${li.bbl}`, "listed twice at once");
    seen.add(li.bbl);
    {
      const lr = resolveRec(parcels, s, li.bbl);
      const v2 = lr ? assetValue(lr, s.econ, initialCondition(lr)) : 0;
      if (v2 > 0 && li.ask < v2 * 0.6) {
        bad("listing", `listing ${li.bbl}`, `asking ${(li.ask / 1e6).toFixed(2)}M against a ${(v2 / 1e6).toFixed(2)}M appraisal \u2014 ${((1 - li.ask / v2) * 100).toFixed(0)}% under`);
      }
    }
  }
  for (const [bbl, a] of Object.entries(s.approaches)) {
    if (a.refused || !a.ask) continue;
    const ar = resolveRec(parcels, s, bbl);
    const v2 = ar ? assetValue(ar, s.econ, initialCondition(ar)) : 0;
    if (v2 > 0 && a.ask < v2 * 0.6) {
      bad("listing", `approach ${bbl}`, `owner asking ${(a.ask / 1e6).toFixed(2)}M against a ${(v2 / 1e6).toFixed(2)}M appraisal`);
    }
  }
  for (const h of Object.values(s.holdings)) {
    for (const t of h.tenants) {
      const d = t.deposit ?? 0;
      if (d < 0 || !fin(d)) bad("deposit", `${h.bbl} ${t.name}`, `deposit ${d}`);
      const monthly = t.rentPsf * t.sf / 12;
      if (monthly > 0 && d > monthly * 3.2) {
        bad("deposit", `${h.bbl} ${t.name}`, `deposit is ${(d / monthly).toFixed(1)} months of rent`);
      }
      const cls = t.use ?? parcels[h.bbl]?.class;
      if (cls && cls !== "multifamily" && t.sf > 0 && t.sf < 2e3 - 1) {
        bad("suite", `${h.bbl} ${t.name}`, `${Math.round(t.sf)} sf commercial tenancy, below the 2,000 sf floor`);
      }
    }
    if (h.leasingHold && s.lois.some((l) => l.bbl === h.bbl)) {
      bad("leasing", `hold ${h.bbl}`, "letting is stopped and there is a live letter of intent on it");
    }
  }
  const loiIds = /* @__PURE__ */ new Set();
  for (const loi of s.lois) {
    const at = `LOI ${loi.id}`;
    if (loiIds.has(loi.id)) bad("loi", at, "duplicate LOI id");
    loiIds.add(loi.id);
    if (!s.holdings[loi.bbl]) bad("loi", at, "a tenant is negotiating for a building you do not own");
    if (!fin(loi.sf) || loi.sf <= 0) bad("loi", at, `${loi.sf} sf`);
    if (!fin(loi.rentPsf) || loi.rentPsf < 0) bad("loi", at, `$${loi.rentPsf}/sf`);
    if (loi.id >= s.nextLoiId) bad("loi", at, `id ${loi.id} is at or past the next id ${s.nextLoiId}`);
  }
  for (const [bbl, b] of Object.entries(s.built ?? {})) {
    const at = `built ${bbl}`;
    if (!parcels[bbl]) {
      bad("built", at, "not a real parcel");
      continue;
    }
    if (!fin(b.bldgArea) || b.bldgArea <= 0) bad("built", at, `${b.bldgArea} sf`);
    if (!fin(b.floors) || b.floors < 1) bad("built", at, `${b.floors} floors`);
    if (b.yearBuilt < 1800 || b.yearBuilt > 2200) bad("built", at, `built in ${b.yearBuilt}`);
    if (b.mix) {
      const tot = Object.values(b.mix).reduce((x, y) => x + y, 0);
      if (!fin(tot) || Math.abs(tot - 1) > 5e-3) bad("mix", at, `delivered mix sums to ${tot}`);
      if (!(b.class in b.mix)) bad("mix", at, `filed as ${b.class}, which is not in its own mix`);
    }
  }
  for (const [id, d] of Object.entries(s.blockD ?? {})) {
    if (!fin(d)) bad("nan", `block ${id}`, `demand drift is ${d}`);
    else if (Math.abs(d) > 40) bad("demand", `block ${id}`, `demand drift ${d.toFixed(1)} beyond the cap`);
  }
  if (s.talks) {
    const t = s.talks;
    const at = `talks ${t.bbl}`;
    if (!parcels[t.bbl]) bad("talks", at, "negotiating over a parcel that does not exist");
    if (s.holdings[t.bbl]) bad("talks", at, "negotiating over a building you already own");
    if (!fin(t.yourPrice) || t.yourPrice <= 0) bad("talks", at, `your price ${t.yourPrice}`);
    if (!fin(t.theirPrice) || t.theirPrice <= 0) bad("talks", at, `their price ${t.theirPrice}`);
    if (t.openedM > s.month) bad("talks", at, `opened in month ${t.openedM}, it is month ${s.month}`);
    if (t.round < 1) bad("talks", at, `round ${t.round}`);
    if (t.agreed) {
      if (!fin(t.agreedPrice ?? NaN) || (t.agreedPrice ?? 0) <= 0) bad("talks", at, `under contract at ${t.agreedPrice}`);
      if (t.closeByM === void 0) bad("talks", at, "under contract with no closing date");
      else if (t.closeByM <= s.month) bad("talks", at, `closing date ${t.closeByM} has passed and the contract is still live`);
      if (!s.listings.some((l) => l.bbl === t.bbl)) bad("talks", at, "under contract on something that is no longer for sale");
    }
  }
  const claimed = /* @__PURE__ */ new Map();
  for (const r of s.rivals ?? []) {
    const at = `rival ${r.name}`;
    if (!fin(r.cash)) bad("nan", at, `cash is ${r.cash}`);
    if (!fin(r.debt) || r.debt < 0) bad("rival", at, `debt ${r.debt}`);
    if (r.basis !== void 0 && (!fin(r.basis) || r.basis < 0)) bad("rival", at, `cost basis ${r.basis}`);
    if (r.taxPaid !== void 0 && (!fin(r.taxPaid) || r.taxPaid < 0)) bad("rival", at, `lifetime tax ${r.taxPaid}`);
    if (r.distributed !== void 0 && (!fin(r.distributed) || r.distributed < 0)) bad("rival", at, `distributions ${r.distributed}`);
    if (r.failedM !== void 0 && r.failedM > s.month) bad("rival", at, `failed in month ${r.failedM}, it is month ${s.month}`);
    for (const bbl of r.bbls) {
      if (!parcels[bbl]) {
        bad("rival", at, `owns ${bbl}, which is not a parcel`);
        continue;
      }
      if (s.holdings[bbl]) bad("rival", at, `owns ${bbl}, and so do you`);
      const other = claimed.get(bbl);
      if (other) bad("rival", at, `owns ${bbl}, and so does ${other}`);
      claimed.set(bbl, r.name);
    }
  }
  for (const d of Object.values(s.developments ?? {})) {
    const at = `development ${d.bbl}`;
    if (!fin(d.equityBudget) || d.equityBudget < 0) bad("dev", at, `equity budget ${d.equityBudget}`);
    if (!fin(d.equitySpent) || d.equitySpent < 0) bad("dev", at, `equity spent ${d.equitySpent}`);
    const pre = d.equityPrefunded ?? 0;
    if (!fin(pre) || pre < 0) bad("dev", at, `prefunded equity ${pre}`);
    if (pre > d.equityBudget + 1) bad("dev", at, `prefunded ${Math.round(pre)} exceeds the whole equity budget ${Math.round(d.equityBudget)}`);
    if (!fin(d.drawn) || d.drawn < 0) bad("dev", at, `drawn ${d.drawn}`);
    if (d.drawn > d.commitment + 1) bad("dev", at, `drawn ${Math.round(d.drawn)} past a ${Math.round(d.commitment)} commitment`);
    if (!fin(d.loanBalance) || d.loanBalance < 0) bad("dev", at, `loan balance ${d.loanBalance}`);
  }
  for (const l of s.lenders ?? []) {
    const at = `lender ${l.name}`;
    if (!fin(l.book) || l.book < 0) bad("lender", at, `book ${l.book}`);
    if (!fin(l.capital)) bad("nan", at, `capital is ${l.capital}`);
    if (!fin(l.delinquent) || l.delinquent < 0 || l.delinquent > 1) bad("lender", at, `delinquency ${l.delinquent}`);
    if (!fin(l.appetite) || l.appetite < 0) bad("lender", at, `appetite ${l.appetite}`);
    if (!fin(l.yours) || l.yours < 0) bad("lender", at, `your balance ${l.yours}`);
    if (!fin(l.chargeOffsTotal) || l.chargeOffsTotal < 0) bad("lender", at, `lifetime charge-offs ${l.chargeOffsTotal}`);
    if (l.failedM !== void 0 && l.failedM > s.month) bad("lender", at, `failed in month ${l.failedM}, it is month ${s.month}`);
    if (l.failedM !== void 0 && l.appetite > 0) bad("lender", at, `in receivership and still quoting at ${l.appetite}`);
  }
  for (const w of Object.values(s.workouts ?? {})) {
    const at = `workout ${w.bbl}`;
    const h = s.holdings[w.bbl];
    if (!h) {
      bad("workout", at, "a file on a building you do not own");
      continue;
    }
    if (!h.loan) bad("workout", at, "a file on a building with no loan on it");
    if (w.startM > s.month) bad("workout", at, `opened in month ${w.startM}, it is month ${s.month}`);
    if (!fin(w.cure) || w.cure < 0) bad("workout", at, `cure amount ${w.cure}`);
    if (w.asks < 0 || w.asks > 4) bad("workout", at, `${w.asks} forbearance requests`);
    if (!["notice", "forbearance", "foreclosure"].includes(w.stage)) bad("workout", at, `stage ${w.stage}`);
    if (w.decideM > s.month + 180) bad("workout", at, `decision date is month ${w.decideM}, ${w.decideM - s.month} months away`);
  }
  if (s.portfolioSale) {
    const ps = s.portfolioSale;
    const at = "portfolio sale";
    if (!fin(ps.ask) || ps.ask <= 0) bad("portfolio", at, `ask ${ps.ask}`);
    if (ps.listedM > s.month) bad("portfolio", at, `listed in month ${ps.listedM}, it is month ${s.month}`);
    if (ps.bbls.length < 2) bad("portfolio", at, `${ps.bbls.length} building(s) in a portfolio`);
    if (new Set(ps.bbls).size !== ps.bbls.length) bad("portfolio", at, "the same deed appears twice");
    for (const b of ps.bbls) {
      if (!s.holdings[b]) bad("portfolio", at, `includes ${b}, which you do not own`);
      if (s.holdings[b]?.sale) bad("portfolio", at, `${b} is in the bundle AND listed on its own`);
    }
    for (const bid of ps.bids ?? []) {
      if (!fin(bid.price) || bid.price <= 0) bad("portfolio", at, `${bid.name} bid ${bid.price}`);
    }
  }
  return v;
}
function assertInvariants(s, parcels) {
  const v = checkInvariants(s, parcels);
  if (v.length) {
    throw new Error(`month ${s.month}: ${v.length} invariant violation(s)
` + v.map((x) => `  [${x.code}] ${x.where}: ${x.detail}`).join("\n"));
  }
}
export {
  ABS_MAX_FLOORS,
  AGENT_FEE,
  BUILD_MONTHS,
  BUYOUT_PREMIUM,
  CAP_BASE,
  CAP_GAINS_RATE,
  CAP_TERM_M,
  CAP_VAC_BETA,
  CITY_STOCK,
  CLOSE_WINDOW_M,
  COMMERCIAL_SUITE_MIN,
  CONDITION_RENT_MULT,
  CONSTRUCTION_LENDER,
  CONTINGENCY,
  CONTRACT_PREMIUM,
  DOMINANT_AT,
  EXCHANGE_WINDOW_M,
  FAR_CEILING,
  FLOOR_HEIGHT_FT,
  HARD_COST_PSF,
  INDUSTRY_LABEL,
  INDUSTRY_VOL,
  LOC_LTV,
  LOC_SPREAD,
  MAKE_READY_PSF,
  MAX_FLOORS_BY_USE,
  MAX_SLENDERNESS,
  MGMT_FEE,
  MILESTONES,
  MIXED_STACK,
  NATURAL_VAC,
  OPEX_CONTROLLABLE,
  OPEX_FIXED,
  OPEX_PSF,
  PRODUCTS,
  PROGRAMS,
  RECAPTURE_RATE,
  RECOVERY_RATE,
  RENO_COST_PSF,
  RENO_MONTHS,
  RENT_BASE,
  RETAIL_FLOORS_MAX,
  SALE_BROKERAGE,
  SECTORS,
  SECTOR_LABEL,
  SOFT_COST,
  SPEC_COST_PSF,
  SPEC_MONTHS,
  SUITE_BOUNDS,
  TAX_RATE,
  TI_ASK,
  TRANSFER_TAX,
  USE_WORD,
  acceptBid,
  acceptCounter,
  acceptPortfolioBid,
  acceptSaleOffer,
  addStock,
  advanceQuarter,
  advanceUntilAttention,
  appraise,
  approachOwner,
  assemblagePressure,
  assembleLots,
  assertInvariants,
  assetValue,
  attentionItems,
  bestAndFinal,
  bidOdds,
  blend,
  blendBy,
  blendExtend,
  blendExtendQuote,
  blockReport,
  buildSpecSuites,
  bumpLand,
  bumpLenderRel,
  buyListing,
  buyOffMarket,
  buyOutTenants,
  buyQuote,
  buyRateCap,
  buyoutQuote,
  capRateFor,
  capRetail,
  capitalRatio,
  chargeLenderLoss,
  checkInvariants,
  claimJob,
  closeDeal,
  collateralHaircut,
  commercialSf,
  commercialShare,
  compFlows,
  compStats,
  concentration,
  concessionPressure,
  counterBid,
  counterOffMarket,
  counterPortfolio,
  counterSale,
  cureWorkout,
  declineSaleOffer,
  deedInLieu,
  delist,
  delistPortfolio,
  demandBeta,
  demandIdx,
  demandLinear,
  demandModel,
  demandNow,
  demolish,
  demolitionCost,
  depositFor,
  depositsHeld,
  depositsOn,
  devMix,
  distressPrice,
  dominantOf,
  dominantUse,
  drawLoc,
  dscr,
  executePurchase,
  farMaxFor,
  fileVariance,
  firstListings,
  genAnchorTenant,
  genRentRoll,
  grantGroundLease,
  grossTaxYr,
  groundLeaseQuote,
  holdingNOIYr,
  holdingValue,
  industryConcentration,
  industryPull,
  industryStress,
  initEcon,
  initLenders,
  initRivals,
  initialCondition,
  isCommercial,
  isMixedUse,
  jobDelivered,
  landPsfNow,
  landValue,
  leasableUses,
  lenderAppetite,
  lenderBlurb,
  lenderByName,
  lenderHealth,
  lenderNames,
  lenderRelOf,
  listForSale,
  listPortfolio,
  livingRivals,
  locAvailable,
  locLimit,
  locRate,
  locationRentMult,
  loiSigningCost,
  ltv,
  managedRentPsfYr,
  markRival,
  markSponsor,
  marketAppetite,
  marketRentPsfYr,
  maxFloorsFor,
  mergeCost,
  mixLabel,
  mixOf,
  monthlyNOI,
  mulberry32Step,
  negotiate,
  netWorth,
  newGame,
  noiAfterTaxYr,
  noiYr,
  normalize,
  normalizeMix,
  normalizeParcels,
  notReadySf,
  occupancy,
  openWorkout,
  operatingStatement,
  opexPsf,
  originate,
  ownerOf,
  physicalMaxFloors,
  planDevelopment,
  portfolioIndustries,
  portfolioQuarterlyCF,
  portfolioQuote,
  prepayPenalty,
  productById,
  productOpen,
  programCost,
  propertyTaxYr,
  quote,
  rateCapCost,
  recordComp,
  recoveryFor,
  recoveryOf,
  refiQuotes,
  refinance,
  refreshListings,
  relDiscount,
  remainingAbatement,
  renovationCost,
  repayLoc,
  repriceListing,
  repricePortfolio,
  requestForbearance,
  reserveFor,
  resolveRec,
  respondLOI,
  retailWantsMixed,
  rivalAsk,
  rivalBuys,
  rivalCondition,
  rng,
  rollQualitySpread,
  rrange,
  saleFeeRate,
  saleTaxQuote,
  sellerOf,
  sellerProfile,
  setBroker,
  setLeasingHold,
  setStance,
  signLoi,
  specSuiteQuote,
  sponsorStanding,
  startDevelopment,
  startProgram,
  startRenovation,
  stockFromParcels,
  suiteSf,
  suiteSfForUnits,
  takeoverDevelopment,
  taxBorneShare,
  tickBrokerCalls,
  tickCityGrowth,
  tickConstructionLeasing,
  tickDemand,
  tickDevelopments,
  tickEcon,
  tickGroundLeases,
  tickLeasing,
  tickLenders,
  tickListingAbsorption,
  tickLoan,
  tickLoc,
  tickPlanning,
  tickPortfolio,
  tickPrograms,
  tickRivals,
  tickSales,
  tickTalks,
  tickWorkouts,
  tickZoning,
  unitCount,
  unitRange,
  unitStatus,
  unitStatusByUse,
  unitsOf,
  useForZone,
  useOccupancy,
  useRentPsfYr,
  useSf,
  useSuiteSf,
  useVacantSf,
  uses,
  vacancyPull,
  vacantSf,
  varianceQuote,
  walkAway,
  walt,
  windowOpen,
  workoutMood
};
