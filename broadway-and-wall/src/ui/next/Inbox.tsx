/**
 * THE INBOX (BUILD_SPEC 3.3): one row per thing that wants you, the verbs
 * that answer it on the row. Row body opens the thing.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { usd } from "@/ui/format";
import { useNext } from "./nextStore";
import { buildInbox, snooze, type InboxItem, type InboxVerb } from "./inboxData";
import { derive } from "@/ui/derive";
import { Drawer, VerbButton } from "./Drawer";

export function useInbox(): { needs: InboxItem[]; later: InboxItem[] } {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const snoozed = useStore((s) => s.docketSnooze);
  return useMemo(() => {
    if (!game) return { needs: [], later: [] };
    const all = derive(game, "next.inbox", () => buildInbox(game, parcels), [parcels]);
    const isLater = (i: InboxItem) => !i.pinned && (snoozed[i.key] ?? -1) > game.month;
    return { needs: all.filter((i) => !isLater(i)), later: all.filter(isLater) };
  }, [game, parcels, snoozed]);
}

export function inboxBadge(needs: InboxItem[]): number {
  return needs.filter((i) => i.sev !== "info").length;
}

export function InboxDrawer() {
  const tab = useNext((s) => s.placeTab.inbox ?? "needs");
  const setTab = (t: string) => useNext.getState().setPlaceTab("inbox", t);
  const { needs, later } = useInbox();
  const doneRows = useNext((s) => s.inboxDone);
  const close = () => useNext.getState().setInboxOpen(false);
  return (
    <Drawer
      width="std"
      title="Inbox"
      tabs={[
        { id: "needs", label: "Needs you", count: inboxBadge(needs) },
        { id: "later", label: "Later", count: later.length },
        { id: "done", label: "Done" },
      ]}
      tab={tab}
      onTab={setTab}
      onClose={close}
    >
      {tab === "done" ? (
        doneRows.length === 0 ? <div className="nx-none">None</div> : (
          <div className="nx-inbox">
            {doneRows.map((r) => (
              <div key={r.key + r.m} className="nx-row nx-sev-info">
                <span className="nx-row-subj">{r.subject}</span>
                <span className="nx-row-facts mono">{r.facts}</span>
                <span className="nx-row-done mono">{r.verb} · {monthLabel(r.m)}</span>
              </div>
            ))}
          </div>
        )
      ) : (
        <InboxList items={tab === "later" ? later : needs} />
      )}
    </Drawer>
  );
}

function InboxList({ items }: { items: InboxItem[] }) {
  if (!items.length) return <div className="nx-none">None</div>;
  return (
    <div className="nx-inbox">
      {items.map((i) => <InboxRow key={i.key} item={i} />)}
    </div>
  );
}

export function InboxRow({ item }: { item: InboxItem }) {
  const [ask, setAsk] = useState<{ v: InboxVerb; n?: number } | null>(null);
  const month = useStore((s) => s.game?.month ?? 0);
  const open = () => useStore.getState().openAttention(item.key);
  const snoozedTill = useStore((s) => s.docketSnooze[item.key]);
  return (
    <div className={"nx-row nx-sev-" + item.sev} onClick={open} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") open(); }}>
      <span className="nx-row-subj">{item.subject}</span>
      <span className="nx-row-facts mono">{item.facts}</span>
      <span className="nx-row-verbs" onClick={(e) => e.stopPropagation()}>
        {ask ? (
          <>
            {ask.v.amount && (
              <input
                className="nx-amt mono"
                type="number"
                autoFocus
                value={ask.n ?? ask.v.amount.initial}
                onChange={(e) => setAsk({ v: ask.v, n: Number(e.target.value) })}
                onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAsk(null); } }}
              />
            )}
            <VerbButton small v={{
              label: ask.v.amount ? `${ask.v.label} ${usd(ask.n ?? ask.v.amount.initial)}` : `Sure? ${ask.v.label}`,
              primary: true,
              run: () => { if (ask.v.amount) ask.v.amount.go(ask.n ?? ask.v.amount.initial); else ask.v.run(); setAsk(null); },
            }} />
            <VerbButton small v={{ label: "Cancel", run: () => setAsk(null) }} />
          </>
        ) : (
          <>
            {item.verbs.slice(0, 3).map((v) => (
              <VerbButton small key={v.label} v={{ ...v, run: () => (v.amount || v.confirm ? setAsk({ v }) : v.run()) }} />
            ))}
            {!item.pinned && !(snoozedTill > month) && <VerbButton small v={{ label: "Later", run: () => snooze(item) }} />}
          </>
        )}
      </span>
    </div>
  );
}
