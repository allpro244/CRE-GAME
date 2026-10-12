import { useState } from "react";
import { useStore } from "@/state/store";
import { TheStreet } from "@/ui/panels/StreetDesk";
import { Owners } from "@/ui/panels/OwnersDesk";
import { ViewSwitch, useDeskView } from "@/ui/panels/shared";

type PlayersView = "street" | "private" | "owners";
const VIEWS: readonly PlayersView[] = ["street", "private", "owners"];

/**
 * WHO ELSE IS IN THIS CITY.
 *
 * This was three tabs on Research — The street, Owners and People — that all
 * answered the same question from different ends, and two of them opened the
 * same drawer. It is one page with one filter strip and one search box now:
 *
 *   Competing firms — the operators that bid on your tape, with the league
 *     table, dry powder, leverage, the take-private desk and Jev's reads.
 *   Private holders — the families and trusts that own most of the town and
 *     rarely trade.
 *   Everyone — the whole register, firms and holders on one scale.
 *
 * People went into the drawers: a rival's principal is on that firm's row, and
 * your own principal and staff are on Firm → Staff. The search box finds a firm
 * by its name or by its principal's.
 */
export function PlayersPage() {
  const game = useStore((s) => s.game)!;
  const setLens = useStore((s) => s.setLens);
  const setPage = useStore((s) => s.setPage);
  const [view, setView, linked] = useDeskView<PlayersView>("players", "street", VIEWS);
  const [q, setQ] = useState("");
  const live = (game.rivals ?? []).filter((r) => r.failedM === undefined).length;
  return (
    <div>
      <div className="players-bar">
        <ViewSwitch<PlayersView>
          label="Who to show"
          on={view}
          set={setView}
          views={[
            { id: "street", label: "Competing firms", n: live, title: "The operators that bid against you" },
            { id: "private", label: "Private holders", title: "Families and trusts — they own most of the town and rarely trade" },
            { id: "owners", label: "Everyone", title: "Every owner in town, firms and holders on one scale" },
          ]}
        />
        <input
          className="input players-search"
          placeholder={view === "street" ? "Firm or principal…" : "Owner…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn" title="Close this page and colour the map by owner"
          onClick={() => { setLens("owners"); setPage("none"); }}>
          Show on map
        </button>
      </div>
      {view === "street" && <TheStreet q={q} scrollToYou={linked} />}
      {view === "private" && <Owners only="private" q={q} />}
      {view === "owners" && <Owners only="all" q={q} />}
    </div>
  );
}
