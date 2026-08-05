import { create } from "zustand";
import type { Adjacency, DataManifest, ParcelTable } from "@/data/types";
import type { GameState, Contract, DevUse, UseMix, BuiltClass } from "@/engine/types";
import { newGame, advanceQuarter, advanceUntilAttention, firstListings, portfolioQuarterlyCF } from "@/engine/sim";
import { buyListing, buyOffMarket, approachOwner, counterOffMarket, listForSale, delist, acceptSaleOffer, declineSaleOffer, counterSale, counterBid, repriceListing, startRenovation,  setBroker, assembleLots, offerGroundLease, pullGroundOffer, bestAndFinal, acceptBid, type BuyProduct } from "@/engine/actions";
import { negotiate, acceptCounter, walkAway, closeDeal } from "@/engine/acquire";
import { respondLOI, answerAsk, buildSpecSuites, blendExtend, buyOutTenants, setLeasingHold, type LOIAction } from "@/engine/leasing";
import { cureWorkout, requestForbearance, deedInLieu, serviceWorkout } from "@/engine/workout";
import { buyNote, modifyNote, fileOnNote, sellNote, discountedPayoff } from "@/engine/notes";
import { registerAuctionBids } from "@/engine/auction";
import { listPortfolio, repricePortfolio, counterPortfolio, acceptPortfolioBid, delistPortfolio } from "@/engine/portfolio";
import { fileVariance } from "@/engine/zoning";
import { refinance, buyRateCap } from "@/engine/debt";
import { drawLoc, repayLoc } from "@/engine/credit";
import { startDevelopment, startProgram, setStance, setOps, setOpsPolicy, demolish } from "@/engine/dev";
import { hire, fire, refreshPool, POOL_REFRESH_M } from "@/engine/staff";
import { normalizeParcels } from "@/engine/mix";
import { netWorth } from "@/engine/value";
import { loadGame, saveGame, listSaves, deleteSave, type SaveMeta } from "@/engine/save";
import { currentCity, currentSeed, setSeed, rerollCity, setCity, currentSize, setSize, currentDev, setDev } from "@/state/city";
import { makeCity, type GeneratedCity } from "@/citygen/index.mjs";

export type Lens = "none" | "land" | "demand" | "owners";
export type Page = "none" | "portfolio" | "deals" | "market" | "research" | "economy" | "books" | "news" | "leasing" | "property" | "saves" | "notes" | "settings" | "staff";

interface AppState {
  parcels: ParcelTable | null;
  bbls: string[];
  adjacency: Adjacency | null;
  manifest: DataManifest | null;
  /** The town this run is played on, generated from (island, seed). */
  city: GeneratedCity | null;
  game: GameState | null;
  selectedBBL: string | null;
  hoveredBBL: string | null;
  // A standing request to put the camera on a parcel. The counter is what makes
  // it fire — asking twice for the same building has to move the map twice, and
  // a bare bbl compares equal to itself.
  flyTo: { bbl: string; n: number } | null;
  lens: Lens;
  page: Page;
  toast: { text: string; kind: "ok" | "err"; at: number } | null;
  /**
   * The July docket, opened deliberately rather than thrown at you. Purely a
   * view flag — it is not part of the save, because whether a panel happens to
   * be open is not a fact about the campaign.
   */
  auctionOpen: boolean;
  fps: number;
  loadError: string | null;
  setData: (d: { parcels: ParcelTable; adjacency: Adjacency; manifest: DataManifest; city?: GeneratedCity }) => void;
  select: (bbl: string | null) => void;
  hover: (bbl: string | null) => void;
  /** Select it AND take the camera there. */
  focus: (bbl: string, closePanel?: boolean) => void;
  setAuctionOpen: (v: boolean) => void;
  setLens: (l: Lens) => void;
  setPage: (p: Page) => void;
  setFps: (fps: number) => void;
  setLoadError: (e: string) => void;
  advance: () => void;
  advanceYear: () => void;
  advanceUntil: () => void;
  counterOff: (bbl: string, px?: number) => void;
  buy: (bbl: string, product: BuyProduct, lev?: number, bid?: number) => void;
  buyOff: (bbl: string, product: BuyProduct, lev?: number, bid?: number) => void;
  approach: (bbl: string) => void;
  respondLoi: (id: number, action: LOIAction, fund?: boolean, counter?: { rentPsf?: number; tiPsf?: number; bestFinal?: boolean }) => void;
  /** Answer a tenant's mid-lease relief letter. */
  answerAsk: (id: number, action: "grant" | "decline") => void;
  /**
   * THE MASTER SWITCH FOR POP-UP CARDS. Every decision the cards carry also
   * lives on a page (letters on the Deals desk, offers on the portfolio, the docket
   * on Marketplace), so turning the cards off loses nothing but the
   * interruption — which is the point when you are simulating twenty years.
   * UI preference, not save state: it persists in localStorage, not the file.
   */
  popupsOff: boolean;
  setPopupsOff: (v: boolean) => void;
  refi: (bbl: string, product: string, lev?: number) => void;
  develop: (bbl: string, use: DevUse, floors: number, coverage: number, contract: Contract, ltcWanted?: number, custom?: { mix?: UseMix; suites?: Partial<Record<BuiltClass, number>> }, lender?: string) => void;
  offer: (bbl: string, price: number, finalOffer?: boolean) => void;
  closeDeal: (bbl: string, product: string, lev: number) => void;
  acceptCounter: (bbl: string) => void;
  walkAway: (bbl: string) => void;
  raze: (bbl: string) => void;
  program: (bbl: string, id: string) => void;
  stance: (bbl: string, v: -1 | 0 | 1) => void;
  ops: (bbl: string, v: { service?: -1 | 0 | 1; plan?: 0 | 1 | 2 }) => void;
  opsPolicy: (v: { service: -1 | 0 | 1; plan: 0 | 1 | 2 }) => void;
  listSale: (bbl: string, ask: number, mode?: "quiet" | "marketed") => void;
  runBestAndFinal: (bbl: string) => void;
  takeBid: (bbl: string, index: number) => void;
  applyVariance: (bbl: string) => void;
  prebuild: (bbl: string, use: string, sf: number) => void;
  extendLease: (bbl: string, idx: number) => void;
  cureDefault: (bbl: string) => void;
  serviceWorkout: (bbl: string, on: boolean) => void;
  sellPortfolio: (bbls: string[], ask: number) => void;
  repricePortfolioSale: (ask: number) => void;
  counterPortfolioBid: (price: number) => void;
  acceptPortfolio: (exchange?: boolean) => void;
  pullPortfolio: () => void;
  askForbearance: (bbl: string) => void;
  takeNote: (id: string) => void;
  restructureNote: (id: string) => void;
  fileNote: (id: string) => void;
  offloadNote: (id: string) => void;
  bidAuction: (bids: Record<string, number>) => void;
  payOffAtDiscount: (bbl: string) => void;
  handBackKeys: (bbl: string) => void;
  buyOutLeases: (bbl: string) => void;
  holdLeasing: (bbl: string, on: boolean) => void;
  assemble: (bbls: string[]) => void;
  groundLease: (bbl: string, years: number) => void;
  pullGroundOffer: (bbl: string) => void;
  delistSale: (bbl: string) => void;
  acceptOffer: (bbl: string, exchange?: boolean) => void;
  declineOffer: (bbl: string) => void;
  counterSale: (bbl: string, price: number) => void;
  counterBid: (bbl: string, index: number, price: number) => void;
  reprice: (bbl: string, ask: number) => void;
  renovate: (bbl: string) => void;
  broker: (bbl: string, on: boolean) => void;
  rateCap: (bbl: string) => void;
  setAgent: (on: boolean) => void;
  drawCredit: (amt: number) => void;
  repayCredit: (amt: number) => void;
  /**
   * THE DESK. Hiring is an offer and a notice period, not a purchase — see
   * engine/staff.ts. Nothing here moves money: the salary bills monthly
   * through the G&A line in sim.ts and the severance is charged inside
   * `fire`, which is where the ledger can see it.
   */
  hireStaff: (candidateId: number) => void;
  fireStaff: (staffId: number) => void;
  postJob: () => void;
  newRun: (island?: string, size?: string, dev?: string) => void;
  devGrant: () => void;
  saveTo: (slot: string) => Promise<void>;
  loadFrom: (slot: string) => Promise<void>;
  dropSave: (slot: string) => Promise<void>;
  slots: SaveMeta[];
  refreshSlots: () => Promise<void>;
}

function toast(text: string, kind: "ok" | "err" = "ok") {
  useStore.setState({ toast: { text, kind, at: Date.now() } });
}

// Every city keeps its own autosave, so switching cities never clobbers the
// campaign you were running in the other one.
const AUTO = () => "auto@" + currentCity();
async function persist(game: GameState) {
  try { await saveGame(AUTO(), game); } catch { /* private-mode browsers: play on without saves */ }
}

export const useStore = create<AppState>((set, get) => ({
  parcels: null,
  bbls: [],
  adjacency: null,
  manifest: null,
  city: null,
  game: null,
  selectedBBL: null,
  hoveredBBL: null,
  flyTo: null,
  lens: "none",
  page: "none",
  auctionOpen: false,
  popupsOff: typeof localStorage !== "undefined" && localStorage.getItem("bw:popups") === "off",
  toast: null,
  fps: 0,
  loadError: null,
  slots: [],
  setData: (d) => set({ ...d, bbls: Object.keys(d.parcels) }),
  select: (bbl) => set({ selectedBBL: bbl, page: bbl && get().page !== "property" ? "none" : get().page }),
  hover: (bbl) => set({ hoveredBBL: bbl }),
  // Reading about a building and finding it are two different things, and a
  // list of addresses in a panel is not a place. Every row that names a
  // property can put the camera on it.
  setAuctionOpen: (v) => set({ auctionOpen: v }),
  focus: (bbl, closePanel = false) => set((st) => ({
    selectedBBL: bbl,
    flyTo: { bbl, n: (st.flyTo?.n ?? 0) + 1 },
    ...(closePanel ? { page: "none" as Page } : {}),
  })),
  setLens: (lens) => set({ lens }),
  setPage: (page) => set({ page }),
  setFps: (fps) => set({ fps }),
  setLoadError: (loadError) => set({ loadError }),

  advance: () => {
    const { game, parcels, bbls, adjacency } = get();
    if (!game || !parcels || game.gameOver) return;
    const next = advanceQuarter(game, parcels, bbls, adjacency);
    set({ game: next });
    void persist(next);
  },

  // A year in one click — but stop early the moment something new needs you.
  advanceYear: () => {
    const { game, parcels, bbls, adjacency } = get();
    if (!game || !parcels || game.gameOver) return;
    const r = advanceUntilAttention(game, parcels, bbls, adjacency, 12);
    set({ game: r.s });
    toast(r.reason ? `Stopped after ${r.months} mo: ${r.reason}` : "A year passes.");
    void persist(r.s);
  },

  // Skip ahead until the game needs a decision (up to 3 years).
  advanceUntil: () => {
    const { game, parcels, bbls, adjacency } = get();
    if (!game || !parcels || game.gameOver) return;
    const r = advanceUntilAttention(game, parcels, bbls, adjacency, 36);
    set({ game: r.s });
    toast(r.reason ? `${r.months} mo later: ${r.reason}` : "Three quiet years. New Alden hums along.");
    void persist(r.s);
  },

  counterOff: (bbl, px) => {
    const { game, parcels, adjacency } = get();
    if (!game || !parcels || !adjacency) return;
    const r = counterOffMarket(game, parcels, adjacency, bbl, px);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    if (r.msg) toast(r.msg);
    void persist(r.s);
  },

  buy: (bbl, product, lev, bid) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buyListing(game, parcels, bbl, product, lev, bid);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Deed recorded. The block knows your name now.");
    void persist(r.s);
  },

  buyOff: (bbl, product, lev, bid) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buyOffMarket(game, parcels, bbl, product, lev, bid);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Off-market. Nobody saw it trade.");
    void persist(r.s);
  },

  approach: (bbl) => {
    const { game, parcels, adjacency } = get();
    if (!game || !parcels || !adjacency) return;
    const r = approachOwner(game, parcels, adjacency, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.refused ? "The owner isn't selling." : "They named a number.", r.refused ? "err" : "ok");
    void persist(r.s);
  },

  respondLoi: (id, action, fund, counter) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = respondLOI(game, parcels, id, action, fund, counter);
    // An error can still carry a new state — a counter the tenant took but you
    // could not fund kills the deal, and that has to stick.
    if (r.err) { toast(r.err, "err"); if (r.s !== game) { set({ game: r.s }); void persist(r.s); } return; }
    set({ game: r.s });
    if (r.msg) toast(r.msg);
    void persist(r.s);
  },

  setPopupsOff: (v) => {
    try { localStorage.setItem("bw:popups", v ? "off" : "on"); } catch { /* private mode */ }
    set({ popupsOff: v });
  },

  answerAsk: (id, action) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = answerAsk(game, parcels, id, action);
    if (r.err) { toast(r.err, "err"); if (r.s !== game) { set({ game: r.s }); void persist(r.s); } return; }
    set({ game: r.s });
    if (r.msg) toast(r.msg);
    void persist(r.s);
  },

  refi: (bbl, product, lev) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = refinance(game, parcels, bbl, product, lev);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Repriced. New paper, new clock.");
    void persist(r.s);
  },

  develop: (bbl, use, floors, coverage, contract, ltcWanted, custom, lender) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = startDevelopment(game, parcels, bbl, use, floors, coverage, contract, ltcWanted, custom, lender);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Ground broken. Watch it rise.");
    void persist(r.s);
  },

  // Buying is a conversation now: the same call opens it and answers their
  // counter, which is why there is one action and not three. It never asks for
  // a lender — agreeing a price and funding the purchase are separate acts.
  offer: (bbl, price, finalOffer) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = negotiate(game, parcels, bbl, price, finalOffer);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); void persist(r.s);
    if (r.msg) toast(r.msg);
  },

  closeDeal: (bbl, product, lev) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = closeDeal(game, parcels, bbl, product, lev);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); void persist(r.s);
    toast(r.msg ?? "Closed. The deed is yours.");
  },

  acceptCounter: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = acceptCounter(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); void persist(r.s);
    if (r.msg) toast(r.msg);
  },

  walkAway: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = walkAway(game, parcels, bbl);
    set({ game: r.s }); void persist(r.s);
    if (r.msg) toast(r.msg);
  },
  raze: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = demolish(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Down it comes.");
    void persist(r.s);
  },

  program: (bbl, id) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = startProgram(game, parcels, bbl, id);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Program funded.");
    void persist(r.s);
  },

  stance: (bbl, v) => {
    const { game } = get();
    if (!game) return;
    const next = setStance(game, bbl, v);
    set({ game: next });
    void persist(next);
  },

  ops: (bbl, v) => {
    const { game } = get();
    if (!game) return;
    const next = setOps(game, bbl, v);
    set({ game: next });
    void persist(next);
  },

  opsPolicy: (v) => {
    const { game } = get();
    if (!game) return;
    const next = setOpsPolicy(game, v);
    set({ game: next });
    toast("House policy set.");
    void persist(next);
  },

  listSale: (bbl, ask, mode = "quiet") => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = listForSale(game, parcels, bbl, ask, mode);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(mode === "marketed" ? "Campaign under way. Offers are due on the date." : "On the market. Now we wait.");
    void persist(r.s);
  },

  runBestAndFinal: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = bestAndFinal(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Bids refreshed.");
    void persist(r.s);
  },

  takeBid: (bbl, index) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = acceptBid(game, parcels, bbl, index);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Under contract.", r.msg === "They retraded you." ? "err" : undefined);
    void persist(r.s);
  },


  prebuild: (bbl, use, sf) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buildSpecSuites(game, parcels, bbl, use as never, sf);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Pre-build under way.");
    void persist(r.s);
  },

  extendLease: (bbl, idx) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = blendExtend(game, parcels, bbl, idx);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Extended.");
    void persist(r.s);
  },

  // The workout desk. Three ways off the table that you choose; the fourth
  // happens to you if you choose none of them.
  // THE BUNDLE. One process, many deeds — see engine/portfolio.ts.
  sellPortfolio: (bbls, ask) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = listPortfolio(game, parcels, bbls, ask);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "In the market.");
    void persist(r.s);
  },

  repricePortfolioSale: (ask) => {
    const { game } = get();
    if (!game) return;
    const r = repricePortfolio(game, ask);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Repriced.");
    void persist(r.s);
  },

  counterPortfolioBid: (price) => {
    const { game } = get();
    if (!game) return;
    const r = counterPortfolio(game, price);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Answered.");
    void persist(r.s);
  },

  acceptPortfolio: (exchange) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = acceptPortfolioBid(game, parcels, exchange);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Closed.");
    void persist(r.s);
  },

  pullPortfolio: () => {
    const { game } = get();
    if (!game) return;
    const next = delistPortfolio(game);
    set({ game: next });
    toast("Pulled from the market.");
    void persist(next);
  },

  // Elect to carry a defaulted loan out of the rest of the book. See
  // engine/workout.ts — the money is charged in tickWorkouts, not here.
  serviceWorkout: (bbl, on) => {
    const { game } = get();
    if (!game) return;
    const r = serviceWorkout(game, bbl, on);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Done.");
    void persist(r.s);
  },

  cureDefault: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = cureWorkout(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Cured.");
    void persist(r.s);
  },

  askForbearance: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = requestForbearance(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Asked.");
    void persist(r.s);
  },

  // THE NOTE DESK. Buying is a decision; servicing is not, and there is
  // deliberately no action here for it — the coupon arrives in tickNotes.
  takeNote: (id) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buyNote(game, parcels, id);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); toast(r.msg ?? "Bought."); void persist(r.s);
  },
  restructureNote: (id) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = modifyNote(game, parcels, id);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); toast(r.msg ?? "Restructured."); void persist(r.s);
  },
  fileNote: (id) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = fileOnNote(game, parcels, id);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); toast(r.msg ?? "Filed."); void persist(r.s);
  },
  offloadNote: (id) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = sellNote(game, parcels, id);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); toast(r.msg ?? "Sold."); void persist(r.s);
  },
  // THE JULY AUCTION. One call, replacing whatever bids were down; ten per
  // cent leaves the account today and the hammer settles the rest next tick.
  bidAuction: (bids) => {
    const { game } = get();
    if (!game) return;
    const r = registerAuctionBids(game, bids);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); toast(r.msg ?? "Registered."); void persist(r.s);
  },
  payOffAtDiscount: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = discountedPayoff(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); toast(r.msg ?? "Paid off."); void persist(r.s);
  },

  handBackKeys: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = deedInLieu(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Keys handed over.", "err");
    void persist(r.s);
  },

  // Clear a building of its tenants, at a price. The only way to a demolition
  // that does not take a decade.
  buyOutLeases: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buyOutTenants(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Empty.");
    void persist(r.s);
  },

  holdLeasing: (bbl, on) => {
    const { game } = get();
    if (!game) return;
    const next = setLeasingHold(game, bbl, on);
    set({ game: next });
    toast(on ? "Letting stopped. The roll runs off from here." : "Letting resumed.");
    void persist(next);
  },


  applyVariance: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = fileVariance(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Filed.");
    void persist(r.s);
  },

  assemble: (bbls) => {
    const { game, parcels, adjacency } = get();
    if (!game || !parcels || !adjacency) return;
    const r = assembleLots(game, parcels, adjacency, bbls);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Assembled.");
    void persist(r.s);
  },

  groundLease: (bbl, years) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = offerGroundLease(game, parcels, bbl, years);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Offered.");
    void persist(r.s);
  },

  pullGroundOffer: (bbl) => {
    const { game } = get();
    if (!game) return;
    const r = pullGroundOffer(game, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(r.msg ?? "Offer withdrawn.");
    void persist(r.s);
  },

  delistSale: (bbl) => {
    const { game } = get();
    if (!game) return;
    const next = delist(game, bbl);
    set({ game: next });
    toast("Pulled from the market.");
    void persist(next);
  },

  acceptOffer: (bbl, exchange) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = acceptSaleOffer(game, parcels, bbl, exchange);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(exchange ? "Closed — the 1031 clock is running." : "Closed. Cash is position.");
    void persist(r.s);
  },

  counterBid: (bbl, index, price) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = counterBid(game, parcels, bbl, index, price);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); void persist(r.s);
    if (r.msg) toast(r.msg);
  },

  reprice: (bbl, ask) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = repriceListing(game, parcels, bbl, ask);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); void persist(r.s);
    if (r.msg) toast(r.msg);
  },

  counterSale: (bbl, price) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = counterSale(game, parcels, bbl, price);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s }); void persist(r.s);
    if (r.msg) toast(r.msg);
  },

  declineOffer: (bbl) => {
    const { game } = get();
    if (!game) return;
    const next = declineSaleOffer(game, bbl);
    set({ game: next });
    toast("Passed. The ask stands.");
    void persist(next);
  },

  renovate: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = startRenovation(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Crews mobilized.");
    void persist(r.s);
  },

  broker: (bbl, on) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = setBroker(game, parcels, bbl, on);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast(on ? "Exclusive signed." : "Broker dismissed.");
    void persist(r.s);
  },

  rateCap: (bbl) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = buyRateCap(game, parcels, bbl);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Capped. Sleep better.");
    void persist(r.s);
  },

  setAgent: (on) => {
    const { game } = get();
    if (!game) return;
    const next = { ...game, agent: on };
    set({ game: next });
    toast(on ? "Your agent has the book. 6% on everything they sign." : "You're handling leasing yourself again.");
    void persist(next);
  },

  drawCredit: (amt) => {
    const { game, parcels } = get();
    if (!game || !parcels) return;
    const r = drawLoc(game, parcels, amt);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Drawn. The meter is running.");
    void persist(r.s);
  },

  repayCredit: (amt) => {
    const { game } = get();
    if (!game) return;
    const r = repayLoc(game, amt);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Paid down.");
    void persist(r.s);
  },

  // THE PAYROLL. An offer is accepted on the spot and then nothing happens for
  // two months while they work out a notice, which is why this toast talks
  // about a start date rather than a hire.
  hireStaff: (candidateId) => {
    const { game } = get();
    if (!game) return;
    const r = hire(game, candidateId);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    toast("Offer accepted. They give notice first — the seat is empty until they walk in.");
    void persist(r.s);
  },

  fireStaff: (staffId) => {
    const { game } = get();
    if (!game) return;
    const r = fire(game, staffId);
    if (r.err) { toast(r.err, "err"); return; }
    set({ game: r.s });
    // Marked as a bad outcome deliberately, the way handing back keys is: it
    // succeeded, and it cost you three months' pay and your coverage.
    toast("Severance paid. Nobody is in that seat now.", "err");
    void persist(r.s);
  },

  /**
   * POST THE JOB.
   *
   * `refreshPool` is called every month by `tickStaff`, so in ordinary play
   * this never has anything to do — which is the point. It is deliberately
   * passed force=false so that a player cannot make the shortlist reshuffle
   * on demand: a hiring market you can spin produces the decision "spin
   * again" instead of "is this person worth $140,000 a year", and staff.ts
   * says so in as many words.
   *
   * What it is actually for is the two moments the tick cannot cover: a brand
   * new campaign, where the desk exists before the first month has been
   * advanced and there is no pool at all, and a save written before any of
   * this existed. In both, the pool is stale by construction and this posts
   * the first one.
   */
  postJob: () => {
    const { game } = get();
    if (!game) return;
    const age = game.month - (game.hirePool?.m ?? -999);
    if (game.hirePool && age < POOL_REFRESH_M) {
      const wait = POOL_REFRESH_M - age;
      toast(`That list went up ${age} month${age === 1 ? "" : "s"} ago. The next one is ${wait} month${wait === 1 ? "" : "s"} out.`, "err");
      return;
    }
    // refreshPool writes into the state it is handed, and zustand repaints on
    // identity — editing the live object would change the pool and render
    // nothing.
    const next: GameState = JSON.parse(JSON.stringify(game));
    refreshPool(next, false);
    set({ game: next });
    toast("The job is posted. Three names on each desk.");
    void persist(next);
  },

  refreshSlots: async () => {
    const all = await listSaves();
    set({ slots: all.filter((m) => m.slot !== "auto" && !m.slot.startsWith("auto@")).sort((a, b) => b.savedAt - a.savedAt) });
  },

  saveTo: async (slot) => {
    const { game } = get();
    if (!game) return;
    await saveGame(slot, game);
    await get().refreshSlots();
    toast(`Saved to “${slot}”.`);
  },

  loadFrom: async (slot) => {
    const { parcels } = get();
    const saved = await loadGame(slot);
    if (!saved || !parcels) { toast("That save wouldn't open.", "err"); return; }
    if (saved.v !== 32) { toast("That save is from an older build and can't be opened.", "err"); return; }

    // A SAVE CARRIES ITS OWN TOWN.
    //
    // Every save has written a citySeed since the city started being generated
    // at runtime, and exactly one code path ever read it — the autosave, at
    // boot. Loading a NAMED slot tested it against whatever town happened to
    // be in memory and refused when they differed, which meant that after a
    // bankruptcy (the one moment you actually want an earlier save) the button
    // said "that save was made on a different city" about YOUR OWN save of
    // YOUR OWN city. The seed was sitting in the object the whole time.
    //
    // Rebuild the town it was played in, the same choreography newRun uses.
    const savedSeed = saved.citySeed;
    const here = get().game?.citySeed ?? currentSeed();
    if (savedSeed !== undefined && savedSeed !== here) {
      toast(`Loading "${slot}" — rebuilding the town it was played in.`);
      setSeed(savedSeed >>> 0);
      try { await saveGame(AUTO(), saved); } catch { /* private mode: the reload will start fresh */ }
      location.reload();
      return;
    }
    // Legacy saves with no seed fall back to the old fit test. BBL ids repeat
    // across seeds, so this is a weak check and only a fallback — a foreign
    // save with two holdings can pass it.
    if (savedSeed === undefined) {
      const fits = Object.keys(saved.holdings).every((b) => parcels[b])
        && saved.listings.every((l) => parcels[l.bbl]);
      if (!fits) { toast("That save was made on a different city — it can't be loaded here.", "err"); return; }
    }
    set({ game: saved, selectedBBL: null, page: "none" });
    void persist(saved);
    toast(`Loaded “${slot}”.`);
  },

  dropSave: async (slot) => {
    await deleteSave(slot);
    await get().refreshSlots();
    toast("Save deleted.");
  },

  // Testing money. Not a game mechanic — a debug lever, and it says so.
  devGrant: () => {
    const { game } = get();
    if (!game) return;
    const g: GameState = { ...game, cash: game.cash + 100_000_000 };
    g.news = [{ q: g.month, kind: "info", text: "DEV: $100.0M of testing capital wired in. This never happens in the real game." }, ...g.news];
    set({ game: g });
    void persist(g);
    toast("+$100M (testing).");
  },

  /**
   * A NEW RUN IS A NEW TOWN.
   *
   * It used to reroll the market on the same fixed map: the same blocks, the
   * same lot lines, the same buildings in the same places, so by the third
   * campaign you knew which corner was the good corner before you had bought
   * anything. Now the island stays and everything on it is re-cut — new
   * blocks, new parcels, new building stock, new vacant ground. Roughly
   * 300ms, which is why it happens on a page load rather than as a download.
   *
   * The whole thing rebuilds, so this reloads rather than hot-swapping the
   * parcel table, the adjacency graph, four map sources and the skyline
   * underneath a live game.
   */
  newRun: (island?: string, size?: string, dev?: string) => {
    // The autosave is the authority on which town you are in — it was played
    // there — so rolling a new seed without clearing it means the reload puts
    // you straight back in the old city. Erasing the game and rolling the town
    // are the same act, and the button already says so.
    //
    // AND THE ISLAND IS PART OF STARTING OVER, not something you change while
    // playing. Picking one here clears THAT island's autosave before switching
    // to it, because "start a new game in Havenport" has to mean a new game —
    // switchCity on its own drops you into whatever campaign was left running
    // there, which is the flipping-between-towns this whole change removes.
    const from = AUTO();                                    // the game being erased
    const target = island && island !== currentCity() ? island : undefined;
    if (target) setCity(target);
    const to = AUTO();                                      // where we are starting
    // The island size is settled before the town is rolled, because the town
    // is rolled AT that size. Omitted means keep whatever this island was on.
    if (size) setSize(size);
    if (dev) setDev(dev);
    rerollCity();                                           // rolls a town on `to`
    void deleteSave(from)
      .catch(() => { /* nothing saved: nothing to clear */ })
      .then(() => (to === from ? undefined : deleteSave(to).catch(() => {})))
      .then(() => location.reload());
  },
}));

// handle for automated playtests and screenshots, same as window.__map
(window as unknown as { __store?: typeof useStore }).__store = useStore;


export function derivedNetWorth(): number {
  const { game, parcels } = useStore.getState();
  if (!game || !parcels) return 0;
  return netWorth(game, parcels);
}

export function derivedQuarterCF(): number {
  const { game, parcels } = useStore.getState();
  if (!game || !parcels) return 0;
  return portfolioQuarterlyCF(game, parcels);
}

export async function fetchGzJson(url: string) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`${url.split("/").pop()} ${r.status}`);
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Response(buf).body!.pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).json();
  }
  // some hosts transparently decode .gz via Content-Encoding — already JSON
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * BUILD THE CITY, THEN THE GAME.
 *
 * Nothing is fetched. `makeCity` runs the same generator the build pipeline
 * runs — one copy of the code, so a city made here and a city made by
 * `pnpm cities` are byte-identical — and hands back the parcel table, the
 * adjacency graph, the map's own layers and the skyline in about a third of a
 * second. The seed is remembered per island, and a save carries its own, so a
 * refresh puts you back in YOUR town rather than a stranger's.
 */
export async function loadData() {
  const island = currentCity();
  try {
    // The save is the authority on which town this is: it was played there.
    const saved = (await loadGame(AUTO())) ?? (await loadGame("auto"));
    const seed = (saved?.citySeed ?? currentSeed(island)) >>> 0;
    setSeed(seed, island);
    // The save is the authority on size too. A run played on a Great City has
    // deeds that only exist on a Great City — rebuilding it at the standard
    // size would not load a smaller town, it would throw every parcel in the
    // save away. Older saves carry none, which means standard, which is what
    // they were built at.
    const size = saved?.citySize ?? currentSize(island);
    setSize(size, island);
    const dev = saved?.cityDev ?? currentDev();
    setDev(dev);

    // The density preset is a browser-local choice, not part of the save: the
    // same seed renders the same town at whatever scale is set. Default is the
    // shipped calibration until one is chosen.
    const built = makeCity(island, seed, { size, density: dev });
    // Any record the pipeline still files as "mixed" becomes its dominant use
    // plus an explicit mix, once, at the door.
    const parcels = normalizeParcels(built.parcels as ParcelTable);
    useStore.getState().setData({
      parcels,
      adjacency: built.adjacency as Adjacency,
      manifest: built.manifest as DataManifest,
      city: built,
    });

    // A save only fits if every deed in it exists in THIS town. Across seeds
    // it will not, and that is not a corrupt save — it is a save from a city
    // that no longer exists, which is exactly what a reroll means.
    const fits = saved && saved.v === 32 && saved.citySeed === seed && (saved.citySize ?? "city") === size && (saved.cityDev ?? "village") === dev
      && Object.keys(saved.holdings).every((b) => parcels[b])
      && saved.listings.every((l) => parcels[l.bbl]);
    if (fits) {
      useStore.setState({ game: saved });
    } else {
      const bbls = Object.keys(parcels);
      const g = firstListings(newGame(seed, parcels), parcels, bbls);
      g.citySeed = seed;
      g.citySize = size;
      g.cityDev = dev;
      useStore.setState({ game: g });
      void saveGame(AUTO(), g).catch(() => { /* private mode: play on unsaved */ });
    }
  } catch (e) {
    useStore.getState().setLoadError(
      `The city would not build (${(e as Error).message}). This is a bug — please report the seed above.`,
    );
  }
}
